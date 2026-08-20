import React, {useEffect, useMemo, useRef, useState} from "react";
import {
  ActivityIndicator,
  AppState,
  Animated,
  Alert,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  StatusBar,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import TtsImport from "react-native-tts";
import Sound from "react-native-sound";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {SafeAreaProvider} from "react-native-safe-area-context";
import {launchCamera, launchImageLibrary} from "react-native-image-picker";
import {PERMISSIONS, requestMultiple as requestNativePermissions, requestNotifications} from "react-native-permissions";
import TextRecognition, {
  TextRecognitionScript,
} from "@react-native-ml-kit/text-recognition";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from "react-native-vision-camera";

const RNFS: any = require("react-native-fs");
const SILENCE_DELAY_MS = 850;
const Tts: any = TtsImport as any;
const {AySpeech} = NativeModules;

import {SERVER_URL, APP_SHARED_KEY} from "./src/services/api";
import {requestTtsAudioBase64} from "./src/services/tts";
import {
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  LANGUAGES,
} from "./src/constants/languages";
import AppIntro from "./src/components/AppIntro";
import {RemoteCallScreen} from "./src/features/livebridge";
import VoiceWaveform from "./src/components/VoiceWaveform";
import VoiceRing from "./src/components/VoiceRing";
import VoiceStatusCard from "./src/components/VoiceStatusCard";
import ProfileScreen from "./src/screens/ProfileScreen";
import {HomeDashboard, HomeSection} from "./src/features/home";
import type {
  AppMode,
  ChatMessage,
  ConferenceMessage,
  ConferenceParticipant,
  ConferenceSession,
  Language,
  SpeechErrorEvent,
  SpeechResultEvent,
  StreamEvent,
  TranslationHistoryItem,
  TtsQueueItem,
  VoicePace,
} from "./src/types";

function LanguagePicker({
  visible,
  title,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected: Language;
  onSelect: (language: Language) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {LANGUAGES.map(language => {
              const active = language.name === selected.name;
              return (
                <TouchableOpacity
                  key={language.name}
                  style={[styles.languageRow, active && styles.languageRowActive]}
                  onPress={() => {
                    onSelect(language);
                    onClose();
                  }}>
                  <Text style={styles.languageFlag}>{language.flag}</Text>
                  <View style={styles.languageTextWrap}>
                    <Text style={styles.languageNative}>{language.nativeName}</Text>
                    <Text style={styles.languageEnglish}>{language.name}</Text>
                  </View>
                  {active ? <Text style={styles.check}>✓</Text> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function AyTalkMainApp() {
  const [appMode, setAppMode] = useState<AppMode>("translate");
  const [homeVisible, setHomeVisible] = useState(true);
  const [permissionSetupReady, setPermissionSetupReady] = useState(false);
  const [permissionSetupVisible, setPermissionSetupVisible] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState(DEFAULT_SOURCE_LANGUAGE);
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_TARGET_LANGUAGE);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [conversationMode, setConversationMode] = useState(true);
  const [followVoiceTone, setFollowVoiceTone] = useState(true);
  const [voiceGender, setVoiceGender] = useState<"male" | "female">("female");
  const [conferenceParticipants, setConferenceParticipants] = useState<ConferenceParticipant[]>([
    {id: "p1", name: "Kişi 1", language: DEFAULT_SOURCE_LANGUAGE},
    {id: "p2", name: "Kişi 2", language: DEFAULT_TARGET_LANGUAGE},
    {id: "p3", name: "Kişi 3", language: LANGUAGES.find(language => language.name === "English") ?? LANGUAGES[0]},
    {id: "p4", name: "Kişi 4", language: LANGUAGES.find(language => language.name === "French") ?? LANGUAGES[0]},
  ]);
  const [activeConferenceParticipantId, setActiveConferenceParticipantId] = useState("p1");
  const [conferenceListenerParticipantId, setConferenceListenerParticipantId] = useState("p2");
  const [conferenceMessages, setConferenceMessages] = useState<ConferenceMessage[]>([]);
  const [conferenceSessionId, setConferenceSessionId] = useState(`meeting-${Date.now()}`);
  const [conferenceTitle, setConferenceTitle] = useState("Yeni Toplantı");
  const [conferenceCreatedAt, setConferenceCreatedAt] = useState(new Date().toISOString());
  const [savedConferenceSessions, setSavedConferenceSessions] = useState<ConferenceSession[]>([]);
  const [conferenceHistoryOpen, setConferenceHistoryOpen] = useState(false);
  const [conferenceTitleModalOpen, setConferenceTitleModalOpen] = useState(false);
  const [conferenceTitleDraft, setConferenceTitleDraft] = useState("");
  const [conferenceStorageReady, setConferenceStorageReady] = useState(false);
  const [conferencePickerOpen, setConferencePickerOpen] = useState(false);
  const [conferenceNameModalOpen, setConferenceNameModalOpen] = useState(false);
  const [conferenceNameDraft, setConferenceNameDraft] = useState("");
  const [conferenceAutoTurnEnabled, setConferenceAutoTurnEnabled] = useState(true);
  const [conferenceAutoMicEnabled, setConferenceAutoMicEnabled] = useState(true);
  const [conferenceRoundRobinEnabled, setConferenceRoundRobinEnabled] = useState(true);
  const [voicePace, setVoicePace] = useState<VoicePace>("normal");
  const [text, setText] = useState("");
  const [translation, setTranslation] = useState("Çeviri burada görünecek.");
  const [resultLanguage, setResultLanguage] = useState<Language>(LANGUAGES[2]);
  const [assistantMessages, setAssistantMessages] = useState<ChatMessage[]>([]);
  const [translationHistory, setTranslationHistory] = useState<TranslationHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [remoteCallOpen, setRemoteCallOpen] = useState(false);
  const [remoteCallRoomCode, setRemoteCallRoomCode] = useState("");
  const [remoteCallDefaultName, setRemoteCallDefaultName] =
    useState("AyTalk Kullanıcısı");
  const [storageReady, setStorageReady] = useState(false);
  const [assistantHistoryReady, setAssistantHistoryReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState("");
  const [selectedImageBase64, setSelectedImageBase64] = useState("");
  const [selectedImageMime, setSelectedImageMime] = useState("image/jpeg");
  const [ocrSource, setOcrSource] = useState<"device" | "cloud" | "">("");
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [liveCameraOpen, setLiveCameraOpen] = useState(false);
  const [liveVideoTranslationMode, setLiveVideoTranslationMode] = useState(false);
  const [liveCameraPosition, setLiveCameraPosition] = useState<"front" | "back">("back");
  const [videoConversationMode, setVideoConversationMode] = useState(false);
  const [isTakingLivePhoto, setIsTakingLivePhoto] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);

  const accumulatedTextRef = useRef("");
  const latestPartialRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishingRef = useRef(false);
  const pageScrollRef = useRef<ScrollView | null>(null);
  const resultAnim = useRef(new Animated.Value(0)).current;
  const micPulseAnim = useRef(new Animated.Value(1)).current;
  const loadingAnim = useRef(new Animated.Value(0)).current;
  const liveCameraRef = useRef<Camera>(null);
  const activeRequestKeyRef = useRef("");
  const translationCacheRef = useRef<Map<string, string>>(new Map());
  const historySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conferenceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingTtsQueueRef = useRef<TtsQueueItem[]>([]);
  const streamingTtsBufferRef = useRef("");
  const streamingTtsPlayingRef = useRef(false);
  const streamingTtsSessionRef = useRef(0);
  const listeningStartedAtRef = useRef(0);
  const currentSoundRef = useRef<Sound | null>(null);
  const currentSoundDoneRef = useRef<(() => void) | null>(null);
  const autoConferenceMicStartingRef = useRef(false);
  const liveCameraDevice = useCameraDevice(liveCameraPosition);

  const liveCameraFormat = useMemo(() => {
    if (!liveCameraDevice?.formats?.length) {
      return undefined;
    }

    const targetLongSide = 1920;
    const targetShortSide = 1080;

    const scoredFormats = liveCameraDevice.formats
      .filter(format => {
        const width = Number(format.videoWidth || 0);
        const height = Number(format.videoHeight || 0);
        const maxFps = Number(format.maxFps || 0);

        return width > 0 && height > 0 && maxFps >= 24;
      })
      .map(format => {
        const width = Number(format.videoWidth || 0);
        const height = Number(format.videoHeight || 0);
        const longSide = Math.max(width, height);
        const shortSide = Math.min(width, height);
        const maxFps = Number(format.maxFps || 0);

        const resolutionDistance =
          Math.abs(longSide - targetLongSide) +
          Math.abs(shortSide - targetShortSide);

        const fpsPenalty = maxFps >= 30 ? 0 : 5000;
        const oversizedPenalty =
          longSide > 2560 || shortSide > 1440 ? 2500 : 0;

        return {
          format,
          score: resolutionDistance + fpsPenalty + oversizedPenalty,
        };
      })
      .sort((first, second) => first.score - second.score);

    return scoredFormats[0]?.format ?? liveCameraDevice.formats[0];
  }, [liveCameraDevice]);

  const liveCameraFps = useMemo(() => {
    if (!liveCameraFormat) {
      return 30;
    }

    const minFps = Number(liveCameraFormat.minFps || 1);
    const maxFps = Number(liveCameraFormat.maxFps || 30);

    if (minFps <= 30 && maxFps >= 30) {
      return 30;
    }

    return Math.max(minFps, Math.min(maxFps, 30));
  }, [liveCameraFormat]);

  const liveCameraResolutionLabel = useMemo(() => {
    if (!liveCameraFormat) {
      return "Otomatik kalite";
    }

    const width = Number(liveCameraFormat.videoWidth || 0);
    const height = Number(liveCameraFormat.videoHeight || 0);
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);

    if (!longSide || !shortSide) {
      return "Otomatik kalite";
    }

    return `${longSide}×${shortSide} · ${liveCameraFps} FPS`;
  }, [liveCameraFormat, liveCameraFps]);

  const {
    hasPermission: hasLiveCameraPermission,
    requestPermission: requestLiveCameraPermission,
  } = useCameraPermission();




  const activeConferenceParticipant =
    conferenceParticipants.find(item => item.id === activeConferenceParticipantId) ??
    conferenceParticipants[0];

  const conferenceListenerParticipant =
    conferenceParticipants.find(item => item.id === conferenceListenerParticipantId) ??
    conferenceParticipants.find(item => item.id !== activeConferenceParticipantId) ??
    conferenceParticipants[0];

  const startConferenceParticipantTurn = async (
    nextSpeaker: ConferenceParticipant,
    nextListener?: ConferenceParticipant,
  ) => {
    if (
      !nextSpeaker ||
      autoConferenceMicStartingRef.current ||
      isLoading ||
      isListening
    ) {
      return;
    }

    const listener =
      nextListener ??
      conferenceParticipants.find(item => item.id !== nextSpeaker.id) ??
      conferenceParticipants[0];

    setActiveConferenceParticipantId(nextSpeaker.id);
    setConferenceListenerParticipantId(listener.id);
    setSourceLanguage(nextSpeaker.language);
    setTargetLanguage(listener.language);
    setResultLanguage(listener.language);
    setText("");
    setTranslation("Çeviri burada görünecek.");
    accumulatedTextRef.current = "";
    latestPartialRef.current = "";

    if (!conferenceAutoMicEnabled || !AySpeech) return;

    autoConferenceMicStartingRef.current = true;

    try {
      const granted = await requestMicrophonePermission();

      if (!granted) {
        Alert.alert(
          "Mikrofon izni gerekli",
          "Otomatik mikrofon geçişi için telefon ayarlarından mikrofon izni ver.",
        );
        return;
      }

      await new Promise<void>(resolve => setTimeout(resolve, 450));

      clearSilenceTimer();
      finishingRef.current = false;
      accumulatedTextRef.current = "";
      latestPartialRef.current = "";
      listeningStartedAtRef.current = Date.now();
      setIsListening(true);
      AySpeech.startContinuous(nextSpeaker.language.speech);
    } catch (error) {
      setIsListening(false);
      Alert.alert(
        "Otomatik mikrofon başlatılamadı",
        error instanceof Error ? error.message : "Bilinmeyen hata.",
      );
    } finally {
      autoConferenceMicStartingRef.current = false;
    }
  };

  const completeConferenceTurnAfterAudio = async (
    translatedText: string,
    spokenLanguage: Language,
  ) => {
    await speakTranslation(translatedText, spokenLanguage);

    if (
      appMode !== "conference" ||
      !conferenceAutoTurnEnabled ||
      autoConferenceMicStartingRef.current
    ) {
      return;
    }

    const previousSpeaker = activeConferenceParticipant;

    if (conferenceParticipants.length === 2) {
      const nextSpeaker = conferenceListenerParticipant;

      if (!nextSpeaker || nextSpeaker.id === previousSpeaker.id) return;

      await startConferenceParticipantTurn(nextSpeaker, previousSpeaker);
      return;
    }

    if (!conferenceRoundRobinEnabled) {
      // 3–8 kişilik manuel modda kullanıcı aşağıdaki
      // “Sıradaki konuşmacı” kartlarından seçim yapar.
      return;
    }

    const currentIndex = conferenceParticipants.findIndex(
      participant => participant.id === previousSpeaker.id,
    );
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + 1) % conferenceParticipants.length
        : 0;
    const nextSpeaker = conferenceParticipants[nextIndex];

    if (!nextSpeaker || nextSpeaker.id === previousSpeaker.id) return;

    await startConferenceParticipantTurn(nextSpeaker, previousSpeaker);
  };

  const selectConferenceParticipant = (participant: ConferenceParticipant) => {
    if (isListening || isLoading) return;
    setActiveConferenceParticipantId(participant.id);
    setSourceLanguage(participant.language);
    if (participant.id === conferenceListenerParticipantId) {
      const nextListener = conferenceParticipants.find(item => item.id !== participant.id);
      if (nextListener) {
        setConferenceListenerParticipantId(nextListener.id);
        setTargetLanguage(nextListener.language);
      }
    }
    setText("");
    accumulatedTextRef.current = "";
    latestPartialRef.current = "";
  };


  const selectConferenceListener = (participant: ConferenceParticipant) => {
    if (isListening || isLoading || participant.id === activeConferenceParticipantId) return;
    setConferenceListenerParticipantId(participant.id);
    setTargetLanguage(participant.language);
    setResultLanguage(participant.language);
    setTranslation("Çeviri burada görünecek.");
  };

  const swapConferenceSpeakerAndListener = () => {
    if (isListening || isLoading || !conferenceListenerParticipant) return;
    const previousSpeaker = activeConferenceParticipant;
    const previousListener = conferenceListenerParticipant;
    setActiveConferenceParticipantId(previousListener.id);
    setConferenceListenerParticipantId(previousSpeaker.id);
    setSourceLanguage(previousListener.language);
    setTargetLanguage(previousSpeaker.language);
    setResultLanguage(previousSpeaker.language);
    setText("");
    setTranslation("Çeviri burada görünecek.");
    accumulatedTextRef.current = "";
    latestPartialRef.current = "";
  };

  const updateActiveConferenceLanguage = (language: Language) => {
    setConferenceParticipants(previous =>
      previous.map(participant =>
        participant.id === activeConferenceParticipantId
          ? {...participant, language}
          : participant,
      ),
    );
    setSourceLanguage(language);
  };

  const openConferenceNameEditor = () => {
    setConferenceNameDraft(activeConferenceParticipant.name);
    setConferenceNameModalOpen(true);
  };

  const saveConferenceParticipantName = () => {
    const cleanName = conferenceNameDraft.trim().slice(0, 24);
    if (!cleanName) {
      Alert.alert("AyTalk Konferans", "Katılımcı adı boş bırakılamaz.");
      return;
    }

    setConferenceParticipants(previous =>
      previous.map(participant =>
        participant.id === activeConferenceParticipantId
          ? {...participant, name: cleanName}
          : participant,
      ),
    );
    setConferenceNameModalOpen(false);
  };

  const addConferenceParticipant = () => {
    if (conferenceParticipants.length >= 8) {
      Alert.alert("AyTalk Konferans", "Bu sürümde en fazla 8 katılımcı eklenebilir.");
      return;
    }

    const id = `p-${Date.now()}`;
    const participant: ConferenceParticipant = {
      id,
      name: `Kişi ${conferenceParticipants.length + 1}`,
      language: DEFAULT_SOURCE_LANGUAGE,
    };

    setConferenceParticipants(previous => [...previous, participant]);
    setActiveConferenceParticipantId(id);
    setSourceLanguage(participant.language);
  };

  const removeActiveConferenceParticipant = () => {
    if (conferenceParticipants.length <= 2) {
      Alert.alert("AyTalk Konferans", "Konferansta en az 2 katılımcı kalmalıdır.");
      return;
    }

    Alert.alert(
      "Katılımcıyı kaldır",
      `${activeConferenceParticipant.name} konferanstan kaldırılsın mı?`,
      [
        {text: "Vazgeç", style: "cancel"},
        {
          text: "Kaldır",
          style: "destructive",
          onPress: () => {
            const remaining = conferenceParticipants.filter(
              participant => participant.id !== activeConferenceParticipantId,
            );
            const nextParticipant = remaining[0];
            setConferenceParticipants(remaining);
            setActiveConferenceParticipantId(nextParticipant.id);
            setSourceLanguage(nextParticipant.language);
            if (activeConferenceParticipantId === conferenceListenerParticipantId) {
              const nextListener = remaining.find(item => item.id !== nextParticipant.id) ?? remaining[0];
              setConferenceListenerParticipantId(nextListener.id);
              setTargetLanguage(nextListener.language);
            }
          },
        },
      ],
    );
  };

  const buildConferenceSession = (): ConferenceSession => ({
    id: conferenceSessionId,
    title: conferenceTitle.trim() || "Yeni Toplantı",
    participants: conferenceParticipants,
    messages: conferenceMessages,
    targetLanguage,
    activeParticipantId: activeConferenceParticipantId,
    listenerParticipantId: conferenceListenerParticipantId,
    createdAt: conferenceCreatedAt,
    updatedAt: new Date().toISOString(),
  });

  const saveConferenceSessionNow = async () => {
    if (!conferenceStorageReady) return;
    const session = buildConferenceSession();
    const nextSessions = [
      session,
      ...savedConferenceSessions.filter(item => item.id !== session.id),
    ]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 20);
    setSavedConferenceSessions(nextSessions);
    await AsyncStorage.multiSet([
      ["aytalk_active_conference", JSON.stringify(session)],
      ["aytalk_conference_sessions", JSON.stringify(nextSessions)],
    ]);
  };

  const startNewConference = () => {
    Alert.alert("Yeni toplantı", "Mevcut toplantı kaydedilip yeni toplantı başlatılsın mı?", [
      {text: "Vazgeç", style: "cancel"},
      {
        text: "Başlat",
        onPress: () => {
          void saveConferenceSessionNow();
          const now = new Date().toISOString();
          const newParticipants: ConferenceParticipant[] = [
            {id: "p1", name: "Kişi 1", language: DEFAULT_SOURCE_LANGUAGE},
            {id: "p2", name: "Kişi 2", language: DEFAULT_TARGET_LANGUAGE},
          ];
          setConferenceSessionId(`meeting-${Date.now()}`);
          setConferenceTitle("Yeni Toplantı");
          setConferenceCreatedAt(now);
          setConferenceParticipants(newParticipants);
          setActiveConferenceParticipantId("p1");
          setConferenceListenerParticipantId("p2");
          setSourceLanguage(DEFAULT_SOURCE_LANGUAGE);
          setTargetLanguage(DEFAULT_TARGET_LANGUAGE);
          setConferenceMessages([]);
          setText("");
          setTranslation("Çeviri burada görünecek.");
        },
      },
    ]);
  };

  const openConferenceTitleEditor = () => {
    setConferenceTitleDraft(conferenceTitle);
    setConferenceTitleModalOpen(true);
  };

  const saveConferenceTitle = () => {
    const cleanTitle = conferenceTitleDraft.trim().slice(0, 50);
    if (!cleanTitle) {
      Alert.alert("AyTalk Konferans", "Toplantı adı boş bırakılamaz.");
      return;
    }
    setConferenceTitle(cleanTitle);
    setConferenceTitleModalOpen(false);
  };

  const loadConferenceSession = (session: ConferenceSession) => {
    setConferenceSessionId(session.id);
    setConferenceTitle(session.title || "Toplantı");
    setConferenceCreatedAt(session.createdAt || new Date().toISOString());
    setConferenceParticipants(session.participants.length >= 2 ? session.participants : conferenceParticipants);
    setConferenceMessages(session.messages || []);
    setTargetLanguage(session.targetLanguage || DEFAULT_TARGET_LANGUAGE);
    const activeId = session.participants.some(item => item.id === session.activeParticipantId)
      ? session.activeParticipantId
      : session.participants[0]?.id;
    if (activeId) {
      setActiveConferenceParticipantId(activeId);
      const active = session.participants.find(item => item.id === activeId);
      if (active) setSourceLanguage(active.language);
      const listenerId = session.participants.some(item => item.id === session.listenerParticipantId)
        ? session.listenerParticipantId!
        : session.participants.find(item => item.id !== activeId)?.id;
      if (listenerId) {
        setConferenceListenerParticipantId(listenerId);
        const listener = session.participants.find(item => item.id === listenerId);
        if (listener) setTargetLanguage(listener.language);
      }
    }
    setConferenceHistoryOpen(false);
    setAppMode("conference");
    setText("");
    setTranslation("Çeviri burada görünecek.");
  };

  const deleteConferenceSession = (sessionId: string) => {
    Alert.alert("Toplantıyı sil", "Bu kayıtlı toplantı tamamen silinsin mi?", [
      {text: "Vazgeç", style: "cancel"},
      {
        text: "Sil",
        style: "destructive",
        onPress: () => {
          setSavedConferenceSessions(previous => {
            const next = previous.filter(item => item.id !== sessionId);
            AsyncStorage.setItem("aytalk_conference_sessions", JSON.stringify(next)).catch(() => undefined);
            return next;
          });
        },
      },
    ]);
  };

  const shareConferenceTranscript = async () => {
    if (conferenceMessages.length === 0) {
      Alert.alert("AyTalk Konferans", "Paylaşılacak toplantı kaydı bulunmuyor.");
      return;
    }

    const transcript = conferenceMessages
      .map(message => {
        const time = new Date(message.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `[${time}] ${message.participantName} (${message.sourceLanguage.nativeName})\n${message.sourceText}\n→ ${message.targetLanguage.nativeName}: ${message.translatedText}`;
      })
      .join("\n\n");

    try {
      await Share.share({
        title: "AyTalk Konferans Kaydı",
        message: `AyTalk Konferans Kaydı\n\n${transcript}`,
      });
    } catch {}
  };

  const addConferenceMessage = (
    sourceText: string,
    translatedText: string,
    source: Language,
    target: Language,
  ) => {
    if (appMode !== "conference") return;
    const participant =
      conferenceParticipants.find(item => item.id === activeConferenceParticipantId) ??
      conferenceParticipants[0];
    const item: ConferenceMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      participantId: participant.id,
      participantName: participant.name,
      sourceLanguage: source,
      sourceText,
      translatedText,
      targetLanguage: target,
      createdAt: new Date().toISOString(),
    };
    setConferenceMessages(previous => [...previous, item].slice(-100));
  };

  const addTranslationToHistory = (
    sourceText: string,
    translatedText: string,
    source: Language,
    target: Language,
  ) => {
    const item: TranslationHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceText,
      translatedText,
      sourceLanguage: source.name,
      targetLanguage: target.name,
      createdAt: new Date().toISOString(),
      favorite: false,
    };

    setTranslationHistory(previous => [item, ...previous].slice(0, 100));
  };

  const toggleFavorite = (id: string) => {
    setTranslationHistory(previous =>
      previous.map(item =>
        item.id === id ? {...item, favorite: !item.favorite} : item,
      ),
    );
  };

  const clearTranslationHistory = () => {
    Alert.alert("Geçmişi temizle", "Tüm çeviri geçmişi silinsin mi?", [
      {text: "Vazgeç", style: "cancel"},
      {
        text: "Sil",
        style: "destructive",
        onPress: () => {
          setTranslationHistory([]);
          void AsyncStorage.removeItem("aytalk_translation_history");
        },
      },
    ]);
  };

  const shareText = async (value: string) => {
    const clean = value.trim();
    if (!clean || clean.startsWith("Hata:")) return;
    try {
      await Share.share({message: clean});
    } catch {}
  };

  const speechEmitter = useMemo(() => {
    if (!AySpeech) return null;
    return new NativeEventEmitter(AySpeech);
  }, []);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const combineSpeech = (base: string, next: string) => {
    const a = base.trim();
    const b = next.trim();
    if (!a) return b;
    if (!b) return a;
    return `${a} ${b}`.replace(/\s+/g, " ").trim();
  };

  const saveTranslationToCache = (cacheKey: string, reply: string) => {
    translationCacheRef.current.delete(cacheKey);
    translationCacheRef.current.set(cacheKey, reply);

    while (translationCacheRef.current.size > 100) {
      const oldestKey = translationCacheRef.current.keys().next().value;
      if (!oldestKey) break;
      translationCacheRef.current.delete(oldestKey);
    }

    if (!storageReady) return;
    if (cacheSaveTimerRef.current) clearTimeout(cacheSaveTimerRef.current);

    cacheSaveTimerRef.current = setTimeout(() => {
      const entries = Array.from(translationCacheRef.current.entries());
      AsyncStorage.setItem(
        "aytalk_translation_cache",
        JSON.stringify(entries),
      ).catch(error => {
        console.log("Çeviri cache kaydetme hatası:", error);
      });
    }, 250);
  };

  const getTextRecognitionScript = (language: Language) => {
    switch (language.name) {
      case "Chinese (Simplified)":
        return TextRecognitionScript.CHINESE;
      case "Japanese":
        return TextRecognitionScript.JAPANESE;
      case "Korean":
        return TextRecognitionScript.KOREAN;
      case "Hindi":
        return TextRecognitionScript.DEVANAGARI;
      default:
        return TextRecognitionScript.LATIN;
    }
  };

  const recognizeImageTextWithCloud = async ({
    imageBase64,
    mimeType,
  }: {
    imageBase64: string;
    mimeType: string;
  }) => {
    if (!imageBase64) {
      throw new Error("Bulut okuma için görsel verisi hazırlanamadı.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${SERVER_URL}/vision-ocr`, {
        method: "POST",
        headers: {"Content-Type": "application/json", "x-app-key": APP_SHARED_KEY},
        body: JSON.stringify({
          imageBase64,
          mimeType,
          language: sourceLanguage.name,
        }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Bulut görsel okuma başarısız oldu.");
      }

      const recognizedText = String(data?.text || "").trim();

      if (!recognizedText) {
        throw new Error("Bulut sistemi görselde metin bulamadı.");
      }

      setText(recognizedText);
      setOcrSource("cloud");
      setTimeout(
        () => pageScrollRef.current?.scrollToEnd({animated: true}),
        100,
      );

      return recognizedText;
    } finally {
      clearTimeout(timeout);
    }
  };

  const recognizeImageText = async ({
    imageUri,
    imageBase64,
    mimeType,
  }: {
    imageUri: string;
    imageBase64: string;
    mimeType: string;
  }) => {
    try {
      setIsOcrLoading(true);
      setOcrSource("");
      setText("");
      setTranslation("Çeviri burada görünecek.");

      let localText = "";

      try {
        const result = await TextRecognition.recognize(
          imageUri,
          getTextRecognitionScript(sourceLanguage),
        );
        localText = String(result?.text || "").trim();
      } catch (localError) {
        console.log("Cihaz OCR hatası:", localError);
      }

      const cloudPreferredLanguages = new Set([
        "Khmer",
        "Arabic",
        "Thai",
        "Russian",
        "Ukrainian",
      ]);

      const shouldUseCloud =
        cloudPreferredLanguages.has(sourceLanguage.name) ||
        localText.length < 3;

      if (shouldUseCloud) {
        try {
          await recognizeImageTextWithCloud({
            imageBase64,
            mimeType,
          });
          return;
        } catch (cloudError) {
          if (localText) {
            setText(localText);
            setOcrSource("device");
            Alert.alert(
              "Bulut okuma kullanılamadı",
              "Metin cihaz üzerindeki OCR ile algılandı.",
            );
            return;
          }
          throw cloudError;
        }
      }

      setText(localText);
      setOcrSource("device");
      setTimeout(
        () => pageScrollRef.current?.scrollToEnd({animated: true}),
        100,
      );
    } catch (error) {
      Alert.alert(
        "Görsel okuma hatası",
        error instanceof Error
          ? error.message
          : "Fotoğraftaki yazı algılanamadı.",
      );
    } finally {
      setIsOcrLoading(false);
    }
  };

  const usePickedImage = async ({
    uri,
    base64,
    type,
  }: {
    uri?: string;
    base64?: string;
    type?: string;
  }) => {
    const cleanUri = String(uri || "").trim();
    const cleanBase64 = String(base64 || "").trim();
    const mimeType = String(type || "image/jpeg").trim();

    if (!cleanUri) {
      Alert.alert("AyTalk", "Seçilen görsel açılamadı.");
      return;
    }

    setSelectedImageUri(cleanUri);
    setSelectedImageBase64(cleanBase64);
    setSelectedImageMime(mimeType);

    await recognizeImageText({
      imageUri: cleanUri,
      imageBase64: cleanBase64,
      mimeType,
    });
  };

  const openLiveCamera = async () => {
    try {
      let permissionGranted = hasLiveCameraPermission;

      if (!permissionGranted) {
        permissionGranted = await requestLiveCameraPermission();
      }

      if (!permissionGranted) {
        Alert.alert(
          "Kamera izni gerekli",
          "Canlı kamera için telefon ayarlarından kamera izni ver.",
        );
        return;
      }

      setLiveVideoTranslationMode(false);
      setVideoConversationMode(false);
      setLiveCameraPosition("back");
      setLiveCameraOpen(true);
    } catch (error) {
      Alert.alert(
        "Canlı kamera açılamadı",
        error instanceof Error ? error.message : "Bilinmeyen kamera hatası.",
      );
    }
  };

  const openLiveVideoTranslation = async () => {
    try {
      let permissionGranted = hasLiveCameraPermission;

      if (!permissionGranted) {
        permissionGranted = await requestLiveCameraPermission();
      }

      if (!permissionGranted) {
        Alert.alert("Kamera izni gerekli", "Canlı video çeviri için kamera izni ver.");
        return;
      }

      setLiveVideoTranslationMode(true);
      setVideoConversationMode(false);
      setLiveCameraPosition("back");
      setText("");
      setTranslation("Çeviri burada görünecek.");
      setLiveCameraOpen(true);
    } catch (error) {
      Alert.alert(
        "Kamera açılamadı",
        error instanceof Error ? error.message : "Bilinmeyen hata.",
      );
    }
  };

  const openVideoConversation = async () => {
    try {
      let permissionGranted = hasLiveCameraPermission;

      if (!permissionGranted) {
        permissionGranted = await requestLiveCameraPermission();
      }

      if (!permissionGranted) {
        Alert.alert(
          "Kamera izni gerekli",
          "Görüntülü konuşma çevirisi için kamera izni ver.",
        );
        return;
      }

      setLiveVideoTranslationMode(true);
      setVideoConversationMode(true);
      setLiveCameraPosition("front");
      setText("");
      setTranslation("Çeviri burada görünecek.");
      setLiveCameraOpen(true);
    } catch (error) {
      Alert.alert(
        "Kamera açılamadı",
        error instanceof Error ? error.message : "Bilinmeyen hata.",
      );
    }
  };

  const toggleLiveCameraPosition = () => {
    setLiveCameraPosition(position =>
      position === "back" ? "front" : "back",
    );
  };

  const closeLiveCamera = () => {
    if (isListening) {
      try {
        AySpeech?.stopContinuous?.();
      } catch {}
      clearSilenceTimer();
      setIsListening(false);
      finishingRef.current = false;
      accumulatedTextRef.current = "";
      latestPartialRef.current = "";
    }

    setLiveCameraOpen(false);
    setLiveVideoTranslationMode(false);
    setVideoConversationMode(false);
    setLiveCameraPosition("back");
  };

  const takeLiveCameraPhoto = async () => {
    if (!liveCameraRef.current || isTakingLivePhoto) return;

    try {
      setIsTakingLivePhoto(true);

      const photo = await liveCameraRef.current.takePhoto({
        flash: "off",
        enableShutterSound: true,
      });

      const rawPath = String(photo?.path || "").trim();

      if (!rawPath) {
        throw new Error("Kamera fotoğraf dosyası oluşturamadı.");
      }

      const imageUri = rawPath.startsWith("file://")
        ? rawPath
        : `file://${rawPath}`;

      const imageBase64 = await RNFS.readFile(rawPath, "base64");

      setLiveCameraOpen(false);

      await usePickedImage({
        uri: imageUri,
        base64: imageBase64,
        type: "image/jpeg",
      });
    } catch (error) {
      Alert.alert(
        "Fotoğraf çekilemedi",
        error instanceof Error ? error.message : "Bilinmeyen kamera hatası.",
      );
    } finally {
      setIsTakingLivePhoto(false);
    }
  };

  const openCamera = async () => {
    try {
      const response = await launchCamera({
        mediaType: "photo",
        quality: 0.9,
        maxWidth: 1800,
        maxHeight: 1800,
        includeBase64: true,
        saveToPhotos: false,
      });

      if (response.didCancel) return;

      if (response.errorCode) {
        throw new Error(response.errorMessage || response.errorCode);
      }

      const asset = response.assets?.[0];
      await usePickedImage({
        uri: asset?.uri,
        base64: asset?.base64,
        type: asset?.type,
      });
    } catch (error) {
      Alert.alert(
        "Kamera açılamadı",
        error instanceof Error ? error.message : "Bilinmeyen kamera hatası.",
      );
    }
  };

  const openGallery = async () => {
    try {
      const response = await launchImageLibrary({
        mediaType: "photo",
        selectionLimit: 1,
        quality: 0.9,
        maxWidth: 1800,
        maxHeight: 1800,
        includeBase64: true,
      });

      if (response.didCancel) return;

      if (response.errorCode) {
        throw new Error(response.errorMessage || response.errorCode);
      }

      const asset = response.assets?.[0];
      await usePickedImage({
        uri: asset?.uri,
        base64: asset?.base64,
        type: asset?.type,
      });
    } catch (error) {
      Alert.alert(
        "Galeri açılamadı",
        error instanceof Error ? error.message : "Bilinmeyen galeri hatası.",
      );
    }
  };

  const reReadWithCloud = async () => {
    if (!selectedImageBase64) {
      Alert.alert(
        "Bulut okuma kullanılamıyor",
        "Görsel verisi bulunamadı. Fotoğrafı yeniden seç.",
      );
      return;
    }

    try {
      setIsOcrLoading(true);
      await recognizeImageTextWithCloud({
        imageBase64: selectedImageBase64,
        mimeType: selectedImageMime,
      });
    } catch (error) {
      Alert.alert(
        "Bulut görsel okuma hatası",
        error instanceof Error ? error.message : "Görsel okunamadı.",
      );
    } finally {
      setIsOcrLoading(false);
    }
  };

  const streamNdjson = ({
    path,
    body,
    timeoutMs,
    onDelta,
  }: {
    path: string;
    body: Record<string, unknown>;
    timeoutMs: number;
    onDelta: (delta: string, fullText: string) => void;
  }) =>
    new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let processedLength = 0;
      let pendingLine = "";
      let fullText = "";
      let settled = false;

      const finishWithError = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const processAvailableText = (finalPass = false) => {
        const responseText = String(xhr.responseText || "");
        const newText = responseText.slice(processedLength);
        processedLength = responseText.length;
        pendingLine += newText;

        const lines = pendingLine.split("\n");
        pendingLine = finalPass ? "" : lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          let event: StreamEvent;

          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "delta") {
            const delta = String(event.delta || "");
            if (!delta) continue;
            fullText += delta;
            onDelta(delta, fullText);
          }

          if (event.type === "done") {
            const reply = String(event.reply || fullText).trim();
            if (!reply) {
              finishWithError(new Error("Sunucudan boş streaming yanıtı geldi."));
              return;
            }

            if (!settled) {
              settled = true;
              resolve(reply);
            }
          }

          if (event.type === "error") {
            finishWithError(new Error(event.error || "Streaming sunucu hatası."));
            return;
          }
        }

        if (finalPass && pendingLine.trim()) {
          try {
            const event = JSON.parse(pendingLine.trim()) as StreamEvent;
            if (event.type === "done" && !settled) {
              const reply = String(event.reply || fullText).trim();
              settled = true;
              resolve(reply);
            } else if (event.type === "error") {
              finishWithError(new Error(event.error || "Streaming sunucu hatası."));
            }
          } catch {}
        }
      };

      xhr.open("POST", `${SERVER_URL}${path}`, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Accept", "application/x-ndjson");
      xhr.setRequestHeader("x-app-key", APP_SHARED_KEY);
      xhr.timeout = timeoutMs;

      // React Native Android bazı cihazlarda onprogress olayını seyrek tetikler.
      // readyState=3 sırasında responseText'i kısa aralıklarla okuyarak metni
      // gerçekten parça parça ekrana basarız.
      const streamPollTimer = setInterval(() => {
        if (xhr.readyState === 3) {
          processAvailableText(false);
        }
      }, 40);

      xhr.onreadystatechange = () => {
        if (xhr.readyState === 3) {
          processAvailableText(false);
        }
      };

      xhr.onprogress = () => {
        processAvailableText(false);
      };

      xhr.onload = () => {
        clearInterval(streamPollTimer);
        processAvailableText(true);

        if (settled) return;

        if (xhr.status < 200 || xhr.status >= 300) {
          let message = `Sunucu hatası (${xhr.status}).`;

          try {
            const data = JSON.parse(String(xhr.responseText || "{}"));
            message = String(data?.error || message);
          } catch {}

          finishWithError(new Error(message));
          return;
        }

        const reply = fullText.trim();

        if (reply) {
          settled = true;
          resolve(reply);
        } else {
          finishWithError(new Error("Sunucudan streaming yanıtı alınamadı."));
        }
      };

      xhr.onerror = () => {
        clearInterval(streamPollTimer);
        finishWithError(new Error("Streaming bağlantısı kurulamadı."));
      };

      xhr.ontimeout = () => {
        clearInterval(streamPollTimer);
        finishWithError(new Error("Streaming isteği zaman aşımına uğradı."));
      };

      xhr.send(JSON.stringify(body));
    });

  const playMp3File = async (filePath: string) => {
    await new Promise<void>((resolve, reject) => {
      try {
        Sound.setCategory?.("Playback");
        const sound = new Sound(filePath, undefined, (loadError: unknown) => {
          if (loadError) {
            RNFS.unlink(filePath).catch(() => undefined);
            reject(loadError);
            return;
          }

          let completed = false;
          const finish = (success = true) => {
            if (completed) return;
            completed = true;
            if (currentSoundRef.current === sound) {
              currentSoundRef.current = null;
            }
            if (currentSoundDoneRef.current === finish) {
              currentSoundDoneRef.current = null;
            }
            try {
              sound.release();
            } catch {}
            RNFS.unlink(filePath).catch(() => undefined);
            success ? resolve() : reject(new Error("Ses dosyası oynatılamadı."));
          };

          currentSoundRef.current = sound;
          currentSoundDoneRef.current = finish;
          sound.play((success: boolean) => finish(success));
        });
      } catch (error) {
        RNFS.unlink(filePath).catch(() => undefined);
        reject(error);
      }
    });
  };

  const createTtsFile = async (value: string, language: Language) => {
    const clean = value.trim();

    const audioBase64 = await requestTtsAudioBase64({
      text: clean,
      language: language.name,
      followVoiceTone,
      voicePace,
      gender: voiceGender,
    });

    const filePath = `${RNFS.CachesDirectoryPath}/aytalk-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}.mp3`;
    await RNFS.writeFile(filePath, audioBase64, "base64");
    return filePath;
  };

  const stopStreamingTts = () => {
    streamingTtsSessionRef.current += 1;
    streamingTtsQueueRef.current = [];
    streamingTtsBufferRef.current = "";

    const activeSound = currentSoundRef.current;
    const finishActiveSound = currentSoundDoneRef.current;
    currentSoundRef.current = null;
    currentSoundDoneRef.current = null;
    if (activeSound) {
      try {
        activeSound.stop(() => finishActiveSound?.());
      } catch {
        finishActiveSound?.();
      }
    }
  };

  const processStreamingTtsQueue = async () => {
    if (streamingTtsPlayingRef.current) return;
    streamingTtsPlayingRef.current = true;

    try {
      while (streamingTtsQueueRef.current.length > 0) {
        const item = streamingTtsQueueRef.current.shift();
        if (!item || item.sessionId !== streamingTtsSessionRef.current) continue;

        try {
          const filePath = await createTtsFile(item.text, item.language);
          if (item.sessionId !== streamingTtsSessionRef.current) {
            RNFS.unlink(filePath).catch(() => undefined);
            continue;
          }
          await playMp3File(filePath);
        } catch (error) {
          console.log("Streaming TTS parça hatası:", error);
        }
      }
    } finally {
      streamingTtsPlayingRef.current = false;
      if (streamingTtsQueueRef.current.length > 0) {
        void processStreamingTtsQueue();
      }
    }
  };

  const enqueueStreamingTts = (value: string, language: Language) => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean) return;

    streamingTtsQueueRef.current.push({
      text: clean,
      language,
      sessionId: streamingTtsSessionRef.current,
    });
    void processStreamingTtsQueue();
  };

  const beginStreamingTts = () => {
    stopStreamingTts();
    streamingTtsBufferRef.current = "";
  };

  const pushStreamingTtsDelta = (delta: string, language: Language) => {
    streamingTtsBufferRef.current += delta;

    while (true) {
      const buffer = streamingTtsBufferRef.current;
      const sentenceMatch = buffer.match(
        /^([\s\S]*?[.!?…。！？](?:["'’”)]*)?)(?:\s+|$)/,
      );

      if (sentenceMatch?.[1]) {
        enqueueStreamingTts(sentenceMatch[1], language);
        streamingTtsBufferRef.current = buffer.slice(sentenceMatch[0].length);
        continue;
      }

      if (buffer.length >= 220) {
        const splitAt = Math.max(
          buffer.lastIndexOf(",", 200),
          buffer.lastIndexOf(";", 200),
          buffer.lastIndexOf(":", 200),
          buffer.lastIndexOf(" ", 200),
        );

        if (splitAt >= 80) {
          enqueueStreamingTts(buffer.slice(0, splitAt + 1), language);
          streamingTtsBufferRef.current = buffer.slice(splitAt + 1);
          continue;
        }
      }

      break;
    }
  };

  const finishStreamingTts = (language: Language) => {
    const remainder = streamingTtsBufferRef.current.trim();
    streamingTtsBufferRef.current = "";
    if (remainder) enqueueStreamingTts(remainder, language);
  };

  const speakTranslation = async (value: string, language: Language = resultLanguage) => {
    const clean = value.trim();
    if (
      !clean ||
      clean === "Çeviri burada görünecek." ||
      clean === "Yapay zekâ çeviriyor..." ||
      clean.startsWith("Hata:")
    ) {
      return;
    }

    try {
      stopStreamingTts();
      const filePath = await createTtsFile(clean, language);
      await playMp3File(filePath);
    } catch (cloudError) {
      Alert.alert(
        "Bulut TTS Hatası",
        cloudError instanceof Error ? cloudError.message : String(cloudError),
      );
    }
  };

  const revealTranslationProgressively = async (value: string) => {
    const words = value.split(/(\s+)/).filter(Boolean);
    if (words.length <= 4) {
      setTranslation(value);
      return;
    }

    let shown = "";
    const batchSize = words.length > 80 ? 8 : words.length > 35 ? 5 : 3;

    for (let index = 0; index < words.length; index += batchSize) {
      shown += words.slice(index, index + batchSize).join("");
      setTranslation(shown);
      await new Promise<void>(resolve => setTimeout(resolve, 18));
    }
  };

  const translateText = async (value?: string) => {
    const cleanText = String(value ?? text).trim();

    if (!cleanText) {
      Alert.alert("AyTalk", "Önce bir cümle yaz veya konuş.");
      return;
    }

    const sourceAtRequest = sourceLanguage;
    const targetAtRequest = targetLanguage;
    const normalizedText = cleanText.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const cacheKey = `${sourceAtRequest.name}:${targetAtRequest.name}:${normalizedText}`;
    const cachedReply = translationCacheRef.current.get(cacheKey);

    if (cachedReply) {
      setResultLanguage(targetAtRequest);
      setTranslation(cachedReply);
      addTranslationToHistory(
        cleanText,
        cachedReply,
        sourceAtRequest,
        targetAtRequest,
      );
      setTimeout(
        () => pageScrollRef.current?.scrollToEnd({animated: true}),
        50,
      );
      addConferenceMessage(
        cleanText,
        cachedReply,
        sourceAtRequest,
        targetAtRequest,
      );

      if (appMode === "conference") {
        void completeConferenceTurnAfterAudio(cachedReply, targetAtRequest);
      } else {
        void speakTranslation(cachedReply, targetAtRequest);
      }

      if (conversationMode && appMode === "translate") {
        setSourceLanguage(targetAtRequest);
        setTargetLanguage(sourceAtRequest);
        setText("");
        accumulatedTextRef.current = "";
        latestPartialRef.current = "";
      }
      return;
    }

    const requestKey = `translate:${sourceAtRequest.name}:${targetAtRequest.name}:${cleanText}`;
    if (activeRequestKeyRef.current === requestKey) return;
    activeRequestKeyRef.current = requestKey;
    let receivedStreamingText = false;

    try {
      setIsLoading(true);
      setResultLanguage(targetAtRequest);
      setTranslation("");

      const reply = await streamNdjson({
        path: "/chat-stream",
        timeoutMs: 35000,
        body: {
          message: cleanText,
          from: sourceAtRequest.name,
          to: targetAtRequest.name,
        },
        onDelta: (_delta, fullText) => {
          receivedStreamingText = true;
          setTranslation(fullText);
          pageScrollRef.current?.scrollToEnd({animated: false});
        },
      });

      if (!receivedStreamingText) {
        await revealTranslationProgressively(reply);
      } else {
        setTranslation(reply);
      }
      saveTranslationToCache(cacheKey, reply);
      addTranslationToHistory(
        cleanText,
        reply,
        sourceAtRequest,
        targetAtRequest,
      );
      addConferenceMessage(
        cleanText,
        reply,
        sourceAtRequest,
        targetAtRequest,
      );
      setTimeout(
        () => pageScrollRef.current?.scrollToEnd({animated: true}),
        80,
      );

      if (appMode === "conference") {
        void completeConferenceTurnAfterAudio(reply, targetAtRequest);
      } else {
        void speakTranslation(reply, targetAtRequest);
      }

      if (conversationMode && appMode === "translate") {
        setSourceLanguage(targetAtRequest);
        setTargetLanguage(sourceAtRequest);
        setText("");
        accumulatedTextRef.current = "";
        latestPartialRef.current = "";
      }
    } catch (streamError) {
      // Streaming desteklenmezse mevcut JSON endpoint otomatik yedek olur.
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(`${SERVER_URL}/chat`, {
          method: "POST",
          headers: {"Content-Type": "application/json", "x-app-key": APP_SHARED_KEY},
          body: JSON.stringify({
            message: cleanText,
            from: sourceAtRequest.name,
            to: targetAtRequest.name,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || "Sunucu hatası oluştu.");
        }

        const reply = String(data?.reply || "").trim();

        if (!reply) {
          throw new Error("Sunucudan çeviri alınamadı.");
        }

        setTranslation(reply);
        setResultLanguage(targetAtRequest);
        saveTranslationToCache(cacheKey, reply);
        addTranslationToHistory(
          cleanText,
          reply,
          sourceAtRequest,
          targetAtRequest,
        );
        addConferenceMessage(
          cleanText,
          reply,
          sourceAtRequest,
          targetAtRequest,
        );
        if (appMode === "conference") {
          void completeConferenceTurnAfterAudio(reply, targetAtRequest);
        } else {
          void speakTranslation(reply, targetAtRequest);
        }

        if (conversationMode && appMode === "translate") {
          setSourceLanguage(targetAtRequest);
          setTargetLanguage(sourceAtRequest);
          setText("");
          accumulatedTextRef.current = "";
          latestPartialRef.current = "";
        }
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error
            ? fallbackError.name === "AbortError"
              ? "Sunucu 30 saniye içinde cevap vermedi."
              : fallbackError.message
            : streamError instanceof Error
              ? streamError.message
              : "Bilinmeyen bir hata oluştu.";

        if (!receivedStreamingText) {
          setTranslation(`Hata: ${message}`);
        }
        Alert.alert("AyTalk hatası", message);
      }
    } finally {
      if (activeRequestKeyRef.current === requestKey) {
        activeRequestKeyRef.current = "";
      }
      setIsLoading(false);
    }
  };

  const sendAssistantMessage = async (value?: string) => {
    const cleanText = String(value ?? text).trim();

    if (!cleanText) {
      Alert.alert("AyTalk AI", "Önce bir mesaj yaz veya konuş.");
      return;
    }

    const history = assistantMessages.slice(-10);
    const languageAtRequest = sourceLanguage;
    const requestKey = `assistant:${languageAtRequest.name}:${cleanText}`;
    if (activeRequestKeyRef.current === requestKey) return;
    activeRequestKeyRef.current = requestKey;
    const userMessage: ChatMessage = {role: "user", content: cleanText};
    const assistantPlaceholder: ChatMessage = {
      role: "assistant",
      content: "",
    };

    setAssistantMessages(previous => [
      ...previous,
      userMessage,
      assistantPlaceholder,
    ]);
    setText("");
    setIsLoading(true);
    setTimeout(
      () => pageScrollRef.current?.scrollToEnd({animated: true}),
      80,
    );
    beginStreamingTts();

    try {
      const reply = await streamNdjson({
        path: "/assistant-stream",
        timeoutMs: 45000,
        body: {
          message: cleanText,
          language: languageAtRequest.name,
          history,
        },
        onDelta: (delta, fullText) => {
          pushStreamingTtsDelta(delta, languageAtRequest);
          setAssistantMessages(previous => {
            if (previous.length === 0) return previous;

            const next = [...previous];
            next[next.length - 1] = {
              role: "assistant",
              content: fullText,
            };
            return next;
          });
          pageScrollRef.current?.scrollToEnd({animated: false});
        },
      });

      finishStreamingTts(languageAtRequest);

      setAssistantMessages(previous => {
        const next = [...previous];

        if (
          next.length > 0 &&
          next[next.length - 1]?.role === "assistant"
        ) {
          next[next.length - 1] = {
            role: "assistant",
            content: reply,
          };
        } else {
          next.push({role: "assistant", content: reply});
        }

        return next;
      });

      setTimeout(
        () => pageScrollRef.current?.scrollToEnd({animated: true}),
        80,
      );
    } catch (streamError) {
      // Streaming çalışmazsa normal endpoint'e otomatik dönüş.
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(`${SERVER_URL}/assistant`, {
          method: "POST",
          headers: {"Content-Type": "application/json", "x-app-key": APP_SHARED_KEY},
          body: JSON.stringify({
            message: cleanText,
            language: languageAtRequest.name,
            history,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || "Sunucu hatası oluştu.");
        }

        const reply = String(data?.reply || "").trim();

        if (!reply) {
          throw new Error("Yapay zekâdan cevap alınamadı.");
        }

        stopStreamingTts();
        void speakTranslation(reply, languageAtRequest);

        setAssistantMessages(previous => {
          const next = [...previous];

          if (
            next.length > 0 &&
            next[next.length - 1]?.role === "assistant"
          ) {
            next[next.length - 1] = {
              role: "assistant",
              content: reply,
            };
          } else {
            next.push({role: "assistant", content: reply});
          }

            return next;
        });
      } catch (fallbackError) {
        stopStreamingTts();
        const message =
          fallbackError instanceof Error
            ? fallbackError.name === "AbortError"
              ? "Sunucu 30 saniye içinde cevap vermedi."
              : fallbackError.message
            : streamError instanceof Error
              ? streamError.message
              : "Bilinmeyen bir hata oluştu.";

        setAssistantMessages(previous => {
          const next = [...previous];
          const errorMessage: ChatMessage = {
            role: "assistant",
            content: `Hata: ${message}`,
          };

          if (
            next.length > 0 &&
            next[next.length - 1]?.role === "assistant"
          ) {
            next[next.length - 1] = errorMessage;
          } else {
            next.push(errorMessage);
          }

            return next;
        });

        Alert.alert("AyTalk AI hatası", message);
      }
    } finally {
      if (activeRequestKeyRef.current === requestKey) {
        activeRequestKeyRef.current = "";
      }
      setIsLoading(false);
    }
  };

  const submitCurrentText = async (value?: string) => {
    if (appMode === "assistant") await sendAssistantMessage(value);
    else await translateText(value);
  };

  const finishListeningAndSubmit = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    clearSilenceTimer();
    try {
      AySpeech?.stopContinuous?.();
    } catch {}
    setIsListening(false);

    const finalText = combineSpeech(accumulatedTextRef.current, latestPartialRef.current);
    if (finalText) {
      if (followVoiceTone && listeningStartedAtRef.current > 0) {
        const durationSeconds = Math.max(0.8, (Date.now() - listeningStartedAtRef.current) / 1000);
        const charactersPerSecond = finalText.length / durationSeconds;
        const detectedPace: VoicePace =
          charactersPerSecond >= 15
            ? "fast"
            : charactersPerSecond <= 8
              ? "slow"
              : "normal";
        setVoicePace(detectedPace);
      }
      listeningStartedAtRef.current = 0;
      setText(finalText);
      await submitCurrentText(finalText);
    }
    finishingRef.current = false;
  };

  const scheduleAutomaticStop = () => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(finishListeningAndSubmit, SILENCE_DELAY_MS);
  };

  useEffect(() => {
    if (!speechEmitter) return;

    const resultSubscription = speechEmitter.addListener(
      "AySpeechResult",
      (event: SpeechResultEvent) => {
        const recognized = String(event?.text || "").trim();
        if (!recognized) return;

        if (event?.isFinal) {
          accumulatedTextRef.current = combineSpeech(accumulatedTextRef.current, recognized);
          latestPartialRef.current = "";
          setText(accumulatedTextRef.current);
        } else {
          latestPartialRef.current = recognized;
          setText(combineSpeech(accumulatedTextRef.current, recognized));
        }

        if (isListening) scheduleAutomaticStop();
      },
    );

    const stateSubscription = speechEmitter.addListener(
      "AySpeechState",
      (event: {listening?: boolean}) => setIsListening(Boolean(event?.listening)),
    );

    const errorSubscription = speechEmitter.addListener(
      "AySpeechError",
      (event: SpeechErrorEvent) => {
        if (event?.code === 6 || event?.code === 7 || event?.code === 8) return;
        setIsListening(false);
        clearSilenceTimer();
        Alert.alert("Mikrofon hatası", event?.message || "Konuşma algılanamadı.");
      },
    );

    return () => {
      clearSilenceTimer();
      resultSubscription.remove();
      stateSubscription.remove();
      errorSubscription.remove();
    };
  }, [speechEmitter, isListening, appMode, sourceLanguage, targetLanguage, assistantMessages]);

  useEffect(() => {
    let mounted = true;

    const loadSavedData = async () => {
      try {
        const [savedAssistant, savedHistory, savedCache] = await Promise.all([
          AsyncStorage.getItem("aytalk_assistant_messages"),
          AsyncStorage.getItem("aytalk_translation_history"),
          AsyncStorage.getItem("aytalk_translation_cache"),
        ]);

        if (!mounted) return;

        if (savedAssistant) {
          const parsedAssistant = JSON.parse(savedAssistant);
          if (Array.isArray(parsedAssistant)) {
            const safeAssistant = parsedAssistant.filter(
              item =>
                item &&
                (item.role === "user" || item.role === "assistant") &&
                typeof item.content === "string",
            );
            setAssistantMessages(safeAssistant);
          }
        }
        setAssistantHistoryReady(true);

        if (savedHistory) {
          const parsedHistory = JSON.parse(savedHistory);
          if (Array.isArray(parsedHistory)) {
            setTranslationHistory(parsedHistory);
          }
        }

        if (savedCache) {
          const parsedCache = JSON.parse(savedCache);
          if (Array.isArray(parsedCache)) {
            const safeEntries = parsedCache
              .filter(
                item =>
                  Array.isArray(item) &&
                  item.length === 2 &&
                  typeof item[0] === "string" &&
                  typeof item[1] === "string",
              )
              .slice(-100) as [string, string][];
            translationCacheRef.current = new Map(safeEntries);
          }
        }
      } catch (error) {
        console.log("AsyncStorage yükleme hatası:", error);
      } finally {
        if (mounted) setStorageReady(true);
      }
    };

    void loadSavedData();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    if (historySaveTimerRef.current) clearTimeout(historySaveTimerRef.current);

    historySaveTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(
        "aytalk_translation_history",
        JSON.stringify(translationHistory.slice(0, 100)),
      ).catch(error => {
        console.log("Çeviri geçmişi kaydetme hatası:", error);
      });
    }, 250);

    return () => {
      if (historySaveTimerRef.current) clearTimeout(historySaveTimerRef.current);
    };
  }, [translationHistory, storageReady]);

  useEffect(() => {
    if (!storageReady || !assistantHistoryReady) return;
    if (assistantSaveTimerRef.current) clearTimeout(assistantSaveTimerRef.current);

    assistantSaveTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(
        "aytalk_assistant_messages",
        JSON.stringify(assistantMessages.slice(-80)),
      ).catch(error => {
        console.log("AI geçmişi kaydetme hatası:", error);
      });
    }, 350);

    return () => {
      if (assistantSaveTimerRef.current) clearTimeout(assistantSaveTimerRef.current);
    };
  }, [assistantMessages, storageReady, assistantHistoryReady]);

  useEffect(() => {
    return () => {
      if (cacheSaveTimerRef.current) clearTimeout(cacheSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    AsyncStorage.getItem("aytalk_voice_style_settings")
      .then(saved => {
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (typeof parsed?.followVoiceTone === "boolean") {
          setFollowVoiceTone(parsed.followVoiceTone);
        }
        if (["slow", "normal", "fast"].includes(parsed?.voicePace)) {
          setVoicePace(parsed.voicePace as VoicePace);
        }
        if (parsed?.voiceGender === "male" || parsed?.voiceGender === "female") {
          setVoiceGender(parsed.voiceGender);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(
      "aytalk_voice_style_settings",
      JSON.stringify({followVoiceTone, voicePace, voiceGender}),
    ).catch(() => undefined);
  }, [followVoiceTone, voicePace, voiceGender]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      AsyncStorage.getItem("aytalk_active_conference"),
      AsyncStorage.getItem("aytalk_conference_sessions"),
    ])
      .then(([activeRaw, sessionsRaw]) => {
        if (!mounted) return;
        if (sessionsRaw) {
          const parsed = JSON.parse(sessionsRaw);
          if (Array.isArray(parsed)) setSavedConferenceSessions(parsed.slice(0, 20));
        }
        if (activeRaw) {
          const session = JSON.parse(activeRaw) as ConferenceSession;
          if (session?.id && Array.isArray(session.participants) && session.participants.length >= 2) {
            setConferenceSessionId(session.id);
            setConferenceTitle(session.title || "Toplantı");
            setConferenceCreatedAt(session.createdAt || new Date().toISOString());
            setConferenceParticipants(session.participants);
            setConferenceMessages(Array.isArray(session.messages) ? session.messages : []);
            setTargetLanguage(session.targetLanguage || DEFAULT_TARGET_LANGUAGE);
            const activeId = session.participants.some(item => item.id === session.activeParticipantId)
              ? session.activeParticipantId
              : session.participants[0].id;
            setActiveConferenceParticipantId(activeId);
            const active = session.participants.find(item => item.id === activeId);
            if (active) setSourceLanguage(active.language);
            const listenerId = session.participants.some(item => item.id === session.listenerParticipantId)
              ? session.listenerParticipantId!
              : session.participants.find(item => item.id !== activeId)?.id;
            if (listenerId) {
              setConferenceListenerParticipantId(listenerId);
              const listener = session.participants.find(item => item.id === listenerId);
              if (listener) setTargetLanguage(listener.language);
            }
          }
        }
      })
      .catch(error => console.log("Konferans kayıt yükleme hatası:", error))
      .finally(() => {
        if (mounted) setConferenceStorageReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!conferenceStorageReady) return;
    if (conferenceSaveTimerRef.current) clearTimeout(conferenceSaveTimerRef.current);
    conferenceSaveTimerRef.current = setTimeout(() => {
      void saveConferenceSessionNow();
    }, 500);
    return () => {
      if (conferenceSaveTimerRef.current) clearTimeout(conferenceSaveTimerRef.current);
    };
  }, [
    conferenceStorageReady,
    conferenceSessionId,
    conferenceTitle,
    conferenceParticipants,
    conferenceMessages,
    targetLanguage,
    activeConferenceParticipantId,
    conferenceListenerParticipantId,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    fetch(`${SERVER_URL}/health`, {signal: controller.signal})
      .catch(() => undefined)
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    try {
      const initResult = Tts?.getInitStatus?.();
      if (initResult?.then) {
        initResult
          .then(() => {
            Tts.setDefaultRate?.(0.48, true);
            Tts.setDefaultPitch?.(1.0);
          })
          .catch(() => undefined);
      }
    } catch {}
    return () => {
      stopStreamingTts();
      try {
        Tts?.stop?.();
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (
      appMode === "assistant" ||
      !translation ||
      translation === "Çeviri burada görünecek." ||
      translation === "Yapay zekâ çeviriyor..." ||
      translation.startsWith("Hata:")
    ) {
      return;
    }

    resultAnim.setValue(0);
    Animated.spring(resultAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
      tension: 65,
    }).start();
  }, [translation, appMode, resultAnim]);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;

    if (isListening) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(micPulseAnim, {
            toValue: 1.08,
            duration: 650,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(micPulseAnim, {
            toValue: 1,
            duration: 650,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
    } else {
      micPulseAnim.stopAnimation();
      micPulseAnim.setValue(1);
    }

    return () => {
      animation?.stop();
    };
  }, [isListening, micPulseAnim]);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;

    if (isLoading) {
      loadingAnim.setValue(0);
      animation = Animated.loop(
        Animated.timing(loadingAnim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      animation.start();
    } else {
      loadingAnim.stopAnimation();
      loadingAnim.setValue(0);
    }

    return () => {
      animation?.stop();
    };
  }, [isLoading, loadingAnim]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", nextState => {
      setAppState(nextState);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem("aytalk_permissions_setup_done")
      .then(value => {
        if (!mounted) return;
        setPermissionSetupVisible(value !== "1");
        setPermissionSetupReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setPermissionSetupVisible(true);
        setPermissionSetupReady(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const completeInitialPermissions = async () => {
    try {
      if (Platform.OS === "android") {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        ];

        if (Platform.Version >= 33) {
          const notificationPermission =
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
          if (notificationPermission) {
            permissions.push(notificationPermission);
          }
        }

        await PermissionsAndroid.requestMultiple(permissions);
      } else if (Platform.OS === "ios") {
        await requestNativePermissions([
          PERMISSIONS.IOS.MICROPHONE,
          PERMISSIONS.IOS.CAMERA,
          PERMISSIONS.IOS.CONTACTS,
          PERMISSIONS.IOS.PHOTO_LIBRARY,
          PERMISSIONS.IOS.SPEECH_RECOGNITION,
        ]);
        await requestNotifications(["alert", "badge", "sound"]);
      }

      await AsyncStorage.setItem("aytalk_permissions_setup_done", "1");
      setPermissionSetupVisible(false);
    } catch (error) {
      Alert.alert(
        "AyTalk İzinleri",
        error instanceof Error ? error.message : "İzinler tamamlanamadı.",
      );
    }
  };

  const openHomeSection = (section: HomeSection) => {
    if (section === "livebridge") {
      setRemoteCallRoomCode("");
      setRemoteCallDefaultName("AyTalk Kullanıcısı");
      setRemoteCallOpen(true);
      return;
    }

    if (section === "history") {
      setHistoryOpen(true);
      return;
    }

    if (section === "profile") {
      setProfileOpen(true);
      return;
    }

    switchMode(section);
    requestAnimationFrame(() => {
      pageScrollRef.current?.scrollTo({y: 0, animated: false});
    });
  };

  const requestMicrophonePermission = async () => {
    if (Platform.OS !== "android") return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "AyTalk Mikrofon İzni",
        message: "AyTalk, konuşmanı yazıya çevirmek için mikrofon erişimine ihtiyaç duyar.",
        buttonPositive: "İzin ver",
        buttonNegative: "Vazgeç",
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const startListening = async () => {
    stopStreamingTts();
    if (!AySpeech) {
      Alert.alert("Mikrofon modülü bulunamadı", "Android mikrofon modülü yüklenemedi.");
      return;
    }

    const granted = await requestMicrophonePermission();
    if (!granted) {
      Alert.alert("Mikrofon izni gerekli", "Telefon ayarlarından mikrofon izni ver.");
      return;
    }

    try {
      clearSilenceTimer();
      finishingRef.current = false;
      accumulatedTextRef.current = "";
      latestPartialRef.current = "";
      setText("");
      listeningStartedAtRef.current = Date.now();
      setIsListening(true);
      AySpeech.startContinuous(sourceLanguage.speech);
    } catch (error) {
      setIsListening(false);
      Alert.alert(
        "Mikrofon başlatılamadı",
        error instanceof Error ? error.message : "Bilinmeyen hata.",
      );
    }
  };

  const toggleMicrophone = async () => {
    if (isListening) await finishListeningAndSubmit();
    else await startListening();
  };

  const swapLanguages = () => {
    if (isListening || isLoading) return;
    const previousSource = sourceLanguage;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(previousSource);
    const oldText = text;
    setText(translation.startsWith("Hata:") ? "" : translation);
    setTranslation(oldText || "Çeviri burada görünecek.");
    setResultLanguage(sourceLanguage);
  };

  const switchMode = (mode: AppMode) => {
    if (isListening || isLoading || isOcrLoading) return;
    stopStreamingTts();
    setHomeVisible(false);
    setAppMode(mode);
    setText("");
    setTranslation("Çeviri burada görünecek.");
    if (mode !== "image") {
      setSelectedImageUri("");
      setSelectedImageBase64("");
      setOcrSource("");
    }
    accumulatedTextRef.current = "";
    latestPartialRef.current = "";
  };

  if (!permissionSetupReady) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#030817" />
        <View style={styles.permissionBoot}>
          <Image
            source={require("./assets/aytalk-main-logo.png")}
            style={styles.permissionBootLogo}
          />
          <ActivityIndicator size="large" color="#2DD4FF" />
        </View>
      </SafeAreaView>
    );
  }

  if (homeVisible) {
    return (
      <>
        <HomeDashboard onOpen={openHomeSection} />

        <RemoteCallScreen
          visible={remoteCallOpen}
          defaultName={remoteCallDefaultName}
          defaultRoomCode={remoteCallRoomCode}
          onClose={() => setRemoteCallOpen(false)}
        />

        <ProfileScreen
          visible={profileOpen}
          usage={{
            translations: translationHistory.length,
            conferences: savedConferenceSessions.length,
            aiMessages: assistantMessages.filter(
              message => message.role === "user",
            ).length,
            favorites: translationHistory.filter(item => item.favorite).length,
          }}
          topLanguages={[]}
          recentActivities={[]}
          onClose={() => setProfileOpen(false)}
        />

        <Modal
          visible={historyOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setHistoryOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.historyModalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Çeviri Geçmişi</Text>
                <TouchableOpacity
                  onPress={() => setHistoryOpen(false)}
                  style={styles.closeButton}>
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.historyTopRow}>
                <Text style={styles.historyCount}>
                  {translationHistory.length} kayıt
                </Text>
                {translationHistory.length > 0 ? (
                  <TouchableOpacity onPress={clearTranslationHistory}>
                    <Text style={styles.deleteHistoryText}>Tümünü sil</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <ScrollView showsVerticalScrollIndicator>
                {translationHistory.length === 0 ? (
                  <Text style={styles.emptyHistoryText}>Henüz kayıtlı çeviri yok.</Text>
                ) : (
                  translationHistory.map(item => (
                    <View key={item.id} style={styles.historyCard}>
                      <View style={styles.historyCardHeader}>
                        <Text style={styles.historyLanguages}>
                          {item.sourceLanguage} → {item.targetLanguage}
                        </Text>
                        <TouchableOpacity onPress={() => toggleFavorite(item.id)}>
                          <Text style={styles.favoriteIcon}>{item.favorite ? "★" : "☆"}</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.historySource} selectable>{item.sourceText}</Text>
                      <Text style={styles.historyTranslation} selectable>{item.translatedText}</Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={permissionSetupVisible}
          transparent
          animationType="fade"
          onRequestClose={() => undefined}>
          <View style={styles.permissionBackdropNew}>
            <View style={styles.permissionCardNew}>
              <Image
                source={require("./assets/aytalk-main-logo.png")}
                style={styles.permissionLogoNew}
              />
              <Text style={styles.permissionTitleNew}>AyTalk'ı hazırla</Text>
              <Text style={styles.permissionTextNew}>
                Mikrofon, kamera, kişiler ve bildirim izinlerini bir kez tanımlayalım.
              </Text>

              <View style={styles.permissionItemsNew}>
                <Text style={styles.permissionItemNew}>🎙  Sesli çeviri ve LiveBridge</Text>
                <Text style={styles.permissionItemNew}>▣  Görsel çeviri ve görüntülü görüşme</Text>
                <Text style={styles.permissionItemNew}>◉  LiveBridge kişileri</Text>
                <Text style={styles.permissionItemNew}>○  Gelen arama bildirimleri</Text>
              </View>

              <TouchableOpacity
                style={styles.permissionButtonNew}
                onPress={() => void completeInitialPermissions()}>
                <Text style={styles.permissionButtonTextNew}>Devam Et</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#071A33" />
      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={pageScrollRef}
          style={styles.pageScroll}
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.featurePageHeader}>
            <TouchableOpacity
              style={styles.featureBackButton}
              onPress={() => {
                stopStreamingTts();
                setHomeVisible(true);
              }}>
              <Text style={styles.featureBackText}>‹</Text>
            </TouchableOpacity>

            <View style={styles.featurePageTitleWrap}>
              <Text style={styles.featurePageTitle}>
                {appMode === "translate"
                  ? "Çeviri"
                  : appMode === "assistant"
                    ? "AI Asistanı"
                    : appMode === "image"
                      ? "Görsel Çeviri"
                      : "Konferans"}
              </Text>
              <Text style={styles.featurePageEnglish}>
                {appMode === "translate"
                  ? "Translation"
                  : appMode === "assistant"
                    ? "AI Assistant"
                    : appMode === "image"
                      ? "Visual Translation"
                      : "Conference"}
              </Text>
            </View>

            <View style={styles.featureHeaderSpacer} />
          </View>

          <View style={[styles.modeTabs, styles.hiddenLegacyNav]}>
            <TouchableOpacity
              style={[styles.modeTab, appMode === "translate" && styles.modeTabActive]}
              onPress={() => switchMode("translate")}>
              <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.78} style={[styles.modeTabText, appMode === "translate" && styles.modeTabTextActive]}>
                🌍 Çeviri
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeTab, appMode === "assistant" && styles.modeTabActive]}
              onPress={() => switchMode("assistant")}>
              <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.modeTabText, appMode === "assistant" && styles.modeTabTextActive]}>
                ✨ AI Asistan
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeTab, appMode === "image" && styles.modeTabActive]}
              onPress={() => switchMode("image")}>
              <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.78} style={[styles.modeTabText, appMode === "image" && styles.modeTabTextActive]}>
                📷 Görsel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeTab, appMode === "conference" && styles.modeTabActive]}
              onPress={() => switchMode("conference")}>
              <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.70} style={[styles.modeTabText, appMode === "conference" && styles.modeTabTextActive]}>
                👥 Konferans
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.quickActions, styles.hiddenLegacyNav]}>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => setHistoryOpen(true)}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.quickActionText}>
                🕘 Geçmiş {translationHistory.length > 0 ? `(${translationHistory.length})` : ""}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => setProfileOpen(true)}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.quickActionText}>👤 Profil</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => {
                setRemoteCallRoomCode("");
                setRemoteCallDefaultName("AyTalk Kullanıcısı");
                setRemoteCallOpen(true);
              }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.quickActionText}>📞 Uzak Arama</Text>
            </TouchableOpacity>

            {appMode !== "assistant" && appMode !== "conference" ? (
              <TouchableOpacity
                style={styles.quickActionButton}
                onPress={() => shareText(translation)}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.quickActionText}>📤 Paylaş</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {appMode !== "image" && appMode !== "conference" ? (
            <View style={styles.voiceStyleRow}>
              <View style={styles.voiceStyleTextWrap}>
                <Text style={styles.voiceStyleTitle}>Ses tonumu takip et</Text>
                <Text style={styles.voiceStyleDescription}>
                  Konuşma hızına göre AI sesini {voicePace === "fast" ? "hızlı" : voicePace === "slow" ? "sakin" : "doğal"} ayarlar.
                </Text>
              </View>
              <Switch value={followVoiceTone} onValueChange={setFollowVoiceTone} />
            </View>
          ) : null}

          {appMode !== "image" && appMode !== "conference" ? (
            <View style={[styles.voiceStyleRow, {marginTop: 10}]}>
              <View style={styles.voiceStyleTextWrap}>
                <Text style={styles.voiceStyleTitle}>Ses cinsiyeti</Text>
                <Text style={styles.voiceStyleDescription}>
                  AI seslendirirken hangi sesi kullansın?
                </Text>
              </View>
              <View style={{flexDirection: "row", gap: 8}}>
                <TouchableOpacity
                  onPress={() => setVoiceGender("female")}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                    backgroundColor: voiceGender === "female" ? "#3D7DFF" : "rgba(255,255,255,0.06)",
                    borderWidth: 1, borderColor: voiceGender === "female" ? "#3D7DFF" : "rgba(255,255,255,0.12)",
                  }}>
                  <Text style={{color: "#FFFFFF", fontWeight: "600"}}>👩</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setVoiceGender("male")}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                    backgroundColor: voiceGender === "male" ? "#3D7DFF" : "rgba(255,255,255,0.06)",
                    borderWidth: 1, borderColor: voiceGender === "male" ? "#3D7DFF" : "rgba(255,255,255,0.12)",
                  }}>
                  <Text style={{color: "#FFFFFF", fontWeight: "600"}}>👨</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {appMode === "translate" || appMode === "image" || appMode === "conference" ? (
            <>
              {appMode === "conference" ? (
                <View style={styles.conferenceCard}>
                  <View style={styles.conferenceHeader}>
                    <View style={styles.conferenceHeaderText}>
                      <TouchableOpacity onPress={openConferenceTitleEditor}>
                        <Text style={styles.conferenceTitle}>{conferenceTitle} ✏️</Text>
                      </TouchableOpacity>
                      <Text style={styles.conferenceDescription}>
                        Konuşan ve dinleyen kişiyi seç. Hedef dil dinleyenin diline otomatik ayarlanır.
                      </Text>
                    </View>
                    <View style={styles.conferenceLiveBadge}>
                      <Text style={styles.conferenceLiveText}>● CANLI</Text>
                    </View>
                  </View>

                  <View style={styles.conferenceSessionActions}>
                    <TouchableOpacity style={styles.conferenceSessionButton} onPress={startNewConference}>
                      <Text style={styles.conferenceSessionButtonText}>＋ Yeni toplantı</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.conferenceSessionButton}
                      onPress={() => setConferenceHistoryOpen(true)}>
                      <Text style={styles.conferenceSessionButtonText}>
                        🗂 Kayıtlar ({savedConferenceSessions.length})
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.conferenceAutomationCard}>
                    <View style={styles.conferenceAutomationRow}>
                      <View style={styles.conferenceAutomationTextWrap}>
                        <Text style={styles.conferenceAutomationTitle}>
                          Otomatik konuşan değişimi
                        </Text>
                        <Text style={styles.conferenceAutomationDescription}>
                          Çeviri sesi bitince dinleyen kişi konuşan olur.
                        </Text>
                      </View>
                      <Switch
                        value={conferenceAutoTurnEnabled}
                        onValueChange={setConferenceAutoTurnEnabled}
                      />
                    </View>

                    <View style={styles.conferenceAutomationDivider} />

                    <View style={styles.conferenceAutomationRow}>
                      <View style={styles.conferenceAutomationTextWrap}>
                        <Text style={styles.conferenceAutomationTitle}>
                          Otomatik mikrofon
                        </Text>
                        <Text style={styles.conferenceAutomationDescription}>
                          Yeni konuşanın dilinde mikrofonu otomatik açar.
                        </Text>
                      </View>
                      <Switch
                        value={conferenceAutoMicEnabled}
                        onValueChange={setConferenceAutoMicEnabled}
                        disabled={!conferenceAutoTurnEnabled}
                      />
                    </View>
                  </View>

                  <View style={styles.participantGrid}>
                    {conferenceParticipants.map(participant => {
                      const active = participant.id === activeConferenceParticipantId;
                      return (
                        <TouchableOpacity
                          key={participant.id}
                          style={[styles.participantCard, active && styles.participantCardActive]}
                          onPress={() => selectConferenceParticipant(participant)}>
                          <Text style={styles.participantAvatar}>{participant.language.flag}</Text>
                          <Text style={[styles.participantName, active && styles.participantNameActive]}>
                            {participant.name}
                          </Text>
                          <Text style={[styles.participantLanguage, active && styles.participantLanguageActive]}>
                            {participant.language.nativeName}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.conferenceActiveRow}>
                    <View style={styles.conferenceActiveInfo}>
                      <Text style={styles.conferenceActiveLabel}>Şu an konuşacak kişi</Text>
                      <Text style={styles.conferenceActiveValue}>
                        {activeConferenceParticipant.name} · {activeConferenceParticipant.language.flag} {activeConferenceParticipant.language.nativeName}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.conferenceLanguageButton}
                      onPress={() => setConferencePickerOpen(true)}>
                      <Text style={styles.conferenceLanguageButtonText}>Dili değiştir</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.conferenceDirectionCard}>
                    <View style={styles.conferenceDirectionHeader}>
                      <Text style={styles.conferenceDirectionTitle}>Kime çevrilecek?</Text>
                      <TouchableOpacity
                        style={styles.conferenceDirectionSwapButton}
                        onPress={swapConferenceSpeakerAndListener}>
                        <Text style={styles.conferenceDirectionSwapText}>⇄ Yer değiştir</Text>
                      </TouchableOpacity>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {conferenceParticipants
                        .filter(participant => participant.id !== activeConferenceParticipantId)
                        .map(participant => {
                          const listening = participant.id === conferenceListenerParticipantId;
                          return (
                            <TouchableOpacity
                              key={`listener-${participant.id}`}
                              style={[styles.listenerChip, listening && styles.listenerChipActive]}
                              onPress={() => selectConferenceListener(participant)}>
                              <Text style={styles.listenerChipFlag}>{participant.language.flag}</Text>
                              <Text style={[styles.listenerChipName, listening && styles.listenerChipNameActive]}>
                                {participant.name}
                              </Text>
                              <Text style={[styles.listenerChipLanguage, listening && styles.listenerChipLanguageActive]}>
                                {participant.language.nativeName}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                    </ScrollView>
                    <Text style={styles.conferenceDirectionSummary}>
                      {activeConferenceParticipant.name} → {conferenceListenerParticipant.name} · {conferenceListenerParticipant.language.flag} {conferenceListenerParticipant.language.nativeName}
                    </Text>
                  </View>

                  <View style={styles.conferenceManageRow}>
                    <TouchableOpacity style={styles.conferenceManageButton} onPress={openConferenceNameEditor}>
                      <Text style={styles.conferenceManageButtonText}>✏️ Adı değiştir</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.conferenceManageButton} onPress={addConferenceParticipant}>
                      <Text style={styles.conferenceManageButtonText}>＋ Katılımcı</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.conferenceRemoveButton} onPress={removeActiveConferenceParticipant}>
                      <Text style={styles.conferenceRemoveButtonText}>− Kaldır</Text>
                    </TouchableOpacity>
                  </View>

                  {conferenceParticipants.length >= 3 ? (
                    <View style={styles.multiPartyCard}>
                      <View style={styles.multiPartyHeader}>
                        <View style={styles.multiPartyTextWrap}>
                          <Text style={styles.multiPartyTitle}>
                            3–8 kişilik konuşma sırası
                          </Text>
                          <Text style={styles.multiPartyDescription}>
                            Sıralı tur açıksa mikrofon Kişi 1 → Kişi 2 → Kişi 3 şeklinde ilerler.
                          </Text>
                        </View>
                        <Switch
                          value={conferenceRoundRobinEnabled}
                          onValueChange={setConferenceRoundRobinEnabled}
                        />
                      </View>

                      <Text style={styles.nextSpeakerLabel}>
                        Sıradaki konuşmacıyı elle seç
                      </Text>

                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}>
                        {conferenceParticipants
                          .filter(
                            participant =>
                              participant.id !== activeConferenceParticipantId,
                          )
                          .map(participant => (
                            <TouchableOpacity
                              key={`next-speaker-${participant.id}`}
                              style={styles.nextSpeakerChip}
                              disabled={isLoading || isListening}
                              onPress={() =>
                                void startConferenceParticipantTurn(
                                  participant,
                                  activeConferenceParticipant,
                                )
                              }>
                              <Text style={styles.nextSpeakerFlag}>
                                {participant.language.flag}
                              </Text>
                              <Text style={styles.nextSpeakerName}>
                                {participant.name}
                              </Text>
                              <Text style={styles.nextSpeakerLanguage}>
                                {participant.language.nativeName}
                              </Text>
                            </TouchableOpacity>
                          ))}
                      </ScrollView>
                    </View>
                  ) : null}

                  {conferenceMessages.length > 0 ? (
                    <View style={styles.conferenceTranscript}>
                      <View style={styles.conferenceTranscriptHeader}>
                        <Text style={styles.conferenceTranscriptTitle}>Toplantı akışı</Text>
                        <View style={styles.conferenceTranscriptActions}>
                          <TouchableOpacity onPress={shareConferenceTranscript}>
                            <Text style={styles.conferenceShareText}>Paylaş</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setConferenceMessages([])}>
                            <Text style={styles.conferenceClearText}>Temizle</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      {conferenceMessages.map(message => (
                        <View key={message.id} style={styles.conferenceMessageCard}>
                          <Text style={styles.conferenceSpeaker}>
                            {message.sourceLanguage.flag} {message.participantName}
                          </Text>
                          <Text style={styles.conferenceOriginal} selectable>{message.sourceText}</Text>
                          <Text style={styles.conferenceTranslated} selectable>
                            {message.targetLanguage.flag} {message.translatedText}
                          </Text>
                          <TouchableOpacity
                            style={styles.conferenceSpeakButton}
                            onPress={() => speakTranslation(message.translatedText, message.targetLanguage)}>
                            <Text style={styles.conferenceSpeakText}>🔊 Dinle</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.languagePanel}>
                <TouchableOpacity
                  style={styles.languageButton}
                  onPress={() => setSourcePickerOpen(true)}
                  disabled={isListening || isLoading || isOcrLoading}>
                  <Text style={styles.selectorLabel}>
                    {appMode === "image" ? "Görseldeki dil" : appMode === "conference" ? "Aktif konuşmacı dili" : "Konuşulan dil"}
                  </Text>
                  <Text style={styles.selectorValue}>
                    {sourceLanguage.flag} {sourceLanguage.nativeName} ▼
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.swapButton} onPress={swapLanguages}>
                  <Text style={styles.swapButtonText}>⇄</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.languageButton}
                  onPress={() => appMode === "conference" ? undefined : setTargetPickerOpen(true)}
                  disabled={isListening || isLoading || isOcrLoading || appMode === "conference"}>
                  <Text style={styles.selectorLabel}>{appMode === "conference" ? "Dinleyenin dili" : "Çevrilecek dil"}</Text>
                  <Text style={styles.selectorValue}>
                    {targetLanguage.flag} {targetLanguage.nativeName} ▼
                  </Text>
                </TouchableOpacity>
              </View>

              {appMode === "translate" ? (
                <View style={styles.conversationRow}>
                  <View style={styles.modeTextWrap}>
                    <Text style={styles.conversationTitle}>Karşılıklı konuşma</Text>
                    <Text style={styles.modeDescription}>
                      Çeviriden sonra diller otomatik yer değiştirir.
                    </Text>
                  </View>
                  <Switch value={conversationMode} onValueChange={setConversationMode} />
                </View>
              ) : (
                <View style={styles.imageToolsCard}>
                  <View style={styles.imageToolsHeader}>
                    <View style={styles.imageToolsHeaderText}>
                      <Text style={styles.imageToolsTitle}>Fotoğraftan çeviri</Text>
                      <Text style={styles.imageToolsDescription}>
                        Fotoğraf çek veya galeriden seç. AyTalk yazıyı cihazında algılar.
                      </Text>
                    </View>
                    <View style={styles.ocrBadge}>
                      <Text style={styles.ocrBadgeText}>OCR</Text>
                    </View>
                  </View>

                  <View style={styles.imageActionRow}>
                    <TouchableOpacity
                      style={styles.imageActionButton}
                      onPress={openCamera}
                      disabled={isOcrLoading || isLoading}>
                      <Text style={styles.imageActionIcon}>📷</Text>
                      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.imageActionTitle}>Fotoğraf çek</Text>
                      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.imageActionSubtitle}>Kamerayı aç</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.imageActionButton}
                      onPress={openGallery}
                      disabled={isOcrLoading || isLoading}>
                      <Text style={styles.imageActionIcon}>🖼️</Text>
                      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.imageActionTitle}>Galeriden seç</Text>
                      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.imageActionSubtitle}>Mevcut görsel</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={styles.liveCameraLaunchButton}
                    onPress={openLiveCamera}
                    disabled={isOcrLoading || isLoading}>
                    <View style={styles.liveCameraLaunchIconWrap}>
                      <Text style={styles.liveCameraLaunchIcon}>🎥</Text>
                    </View>
                    <View style={styles.liveCameraLaunchTextWrap}>
                      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.liveCameraLaunchTitle}>
                        Canlı kamera önizlemesi
                      </Text>
                      <Text numberOfLines={2} ellipsizeMode="tail" style={styles.liveCameraLaunchSubtitle}>
                        Kamerayı tam ekran aç ve fotoğrafı buradan çek
                      </Text>
                    </View>
                    <Text style={styles.liveCameraLaunchArrow}>›</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.liveCameraLaunchButton, styles.liveVideoLaunchButton]}
                    onPress={openLiveVideoTranslation}
                    disabled={isOcrLoading || isLoading}>
                    <View style={[styles.liveCameraLaunchIconWrap, styles.liveVideoLaunchIconWrap]}>
                      <Text style={styles.liveCameraLaunchIcon}>🌐</Text>
                    </View>
                    <View style={styles.liveCameraLaunchTextWrap}>
                      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.liveCameraLaunchTitle}>
                        Canlı video çeviri
                      </Text>
                      <Text numberOfLines={2} ellipsizeMode="tail" style={styles.liveCameraLaunchSubtitle}>
                        Kamera açıkken konuşmayı altyazı olarak çevir
                      </Text>
                    </View>
                    <Text style={styles.liveCameraLaunchArrow}>›</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.liveCameraLaunchButton, styles.videoConversationLaunchButton]}
                    onPress={openVideoConversation}
                    disabled={isOcrLoading || isLoading}>
                    <View style={[styles.liveCameraLaunchIconWrap, styles.videoConversationIconWrap]}>
                      <Text style={styles.liveCameraLaunchIcon}>📹</Text>
                    </View>
                    <View style={styles.liveCameraLaunchTextWrap}>
                      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.liveCameraLaunchTitle}>
                        Görüntülü konuşma çevirisi
                      </Text>
                      <Text numberOfLines={2} ellipsizeMode="tail" style={styles.liveCameraLaunchSubtitle}>
                        Ön kamerayla iki kişilik karşılıklı görüşme
                      </Text>
                    </View>
                    <Text style={styles.liveCameraLaunchArrow}>›</Text>
                  </TouchableOpacity>

                  {selectedImageUri ? (
                    <View style={styles.previewWrap}>
                      <Image
                        source={{uri: selectedImageUri}}
                        style={styles.imagePreview}
                      />
                      <TouchableOpacity
                        style={styles.removeImageButton}
                        onPress={() => {
                          setSelectedImageUri("");
                          setSelectedImageBase64("");
                          setOcrSource("");
                          setText("");
                          setTranslation("Çeviri burada görünecek.");
                        }}>
                        <Text style={styles.removeImageText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {selectedImageUri && !isOcrLoading ? (
                    <View style={styles.ocrUtilityRow}>
                      <View style={styles.ocrSourceBadge}>
                        <Text style={styles.ocrSourceBadgeText}>
                          {ocrSource === "cloud"
                            ? "☁️ Bulut OCR"
                            : ocrSource === "device"
                              ? "📱 Cihaz OCR"
                              : "OCR hazır"}
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={styles.cloudReadButton}
                        onPress={reReadWithCloud}>
                        <Text style={styles.cloudReadButtonText}>
                          ☁️ Bulutla tekrar oku
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {isOcrLoading ? (
                    <View style={styles.ocrLoadingRow}>
                      <ActivityIndicator size="small" color="#0D4FA8" />
                      <Text style={styles.ocrLoadingText}>
                        Fotoğraftaki yazılar algılanıyor...
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            </>
          ) : (
            <View style={styles.assistantHeader}>
              <View style={styles.assistantHeaderText}>
                <Text style={styles.assistantTitle}>AyTalk Yapay Zekâ Asistanı</Text>
                <Text style={styles.assistantDescription}>
                  Sorunu yaz veya konuş. Cevap dili: {sourceLanguage.flag} {sourceLanguage.nativeName}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.smallLanguageButton}
                onPress={() => setSourcePickerOpen(true)}>
                <Text style={styles.smallLanguageButtonText}>Dil ▼</Text>
              </TouchableOpacity>
            </View>
          )}
          {appMode === "assistant" && assistantMessages.length > 0 ? (
            <View style={styles.chatArea}>
              {assistantMessages.map((message, index) => (
                <View
                  key={`${message.role}-${index}`}
                  style={[
                    styles.chatBubble,
                    message.role === "user" ? styles.userBubble : styles.assistantBubble,
                  ]}>
                  <Text style={styles.chatRole}>
                    {message.role === "user" ? "Sen" : "AyTalk AI"}
                  </Text>
                  <Text style={styles.chatText} selectable>
                    {message.content || (isLoading && message.role === "assistant" ? "▍" : "")}
                  </Text>
                  {message.role === "assistant" && message.content.trim() && !message.content.startsWith("Hata:") ? (
                    <TouchableOpacity
                      style={styles.inlineSpeakButton}
                      onPress={() => speakTranslation(message.content, sourceLanguage)}>
                      <Text style={styles.inlineSpeakText}>🔊 Seslendir</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
              <TouchableOpacity
                style={styles.clearChatButton}
                onPress={() => {
                  Alert.alert(
                    "Sohbeti temizle",
                    "Yapay zekâ sohbet geçmişi tamamen silinsin mi?",
                    [
                      {text: "Vazgeç", style: "cancel"},
                      {
                        text: "Sil",
                        style: "destructive",
                        onPress: () => {
                          setAssistantMessages([]);
                          void AsyncStorage.removeItem(
                            "aytalk_assistant_messages",
                          );
                        },
                      },
                    ],
                  );
                }}>
                <Text style={styles.clearChatText}>Sohbeti temizle</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.inputTopRow}>
            <Text style={styles.sectionLabel}>
              {appMode === "assistant" ? "Mesajın" : appMode === "image" ? "Algılanan metin" : appMode === "conference" ? `${activeConferenceParticipant.name} konuşması` : "Çevrilecek metin"}
            </Text>
            <Text style={styles.characterCount}>{text.length} karakter</Text>
          </View>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={
              appMode === "assistant"
                ? `${sourceLanguage.nativeName} bir soru yaz veya mikrofona dokun...`
                : appMode === "image"
                  ? "Fotoğraftan algılanan metin burada görünür. İstersen düzenleyebilirsin."
                  : appMode === "conference"
                    ? `${activeConferenceParticipant.name} için yaz veya mikrofona dokun...`
                    : `${sourceLanguage.nativeName} bir metin yaz veya mikrofona dokun...`
            }
            placeholderTextColor="#7F9AB9"
            multiline
            scrollEnabled={false}
            editable={!isLoading && !isListening && !isOcrLoading}
          />

          <TouchableOpacity
            style={[styles.primaryButton, isLoading && styles.disabledButton]}
            onPress={() => submitCurrentText()}
            disabled={isLoading || isListening}>
            {isLoading ? (
              <View style={styles.loadingContent}>
                <View style={styles.loadingDots}>
                  {[0, 1, 2].map(index => {
                    const inputStart = index * 0.18;
                    const inputPeak = inputStart + 0.18;
                    const inputEnd = Math.min(inputPeak + 0.22, 1);

                    return (
                      <Animated.View
                        key={index}
                        style={[
                          styles.loadingDot,
                          {
                            opacity: loadingAnim.interpolate({
                              inputRange: [0, inputStart, inputPeak, inputEnd, 1],
                              outputRange: [0.35, 0.35, 1, 0.35, 0.35],
                            }),
                            transform: [
                              {
                                translateY: loadingAnim.interpolate({
                                  inputRange: [0, inputStart, inputPeak, inputEnd, 1],
                                  outputRange: [0, 0, -5, 0, 0],
                                }),
                              },
                            ],
                          },
                        ]}
                      />
                    );
                  })}
                </View>
                <Text style={styles.loadingText}>
                  {appMode === "assistant" ? "AyTalk düşünüyor" : "Çeviri hazırlanıyor"}
                </Text>
              </View>
            ) : (
              <Text style={styles.primaryButtonText}>
                {appMode === "assistant"
                  ? "✨ Asistana Gönder"
                  : appMode === "image"
                    ? `${targetLanguage.flag} Görsel Metnini Çevir`
                    : appMode === "conference"
                      ? `${targetLanguage.flag} Toplantıya Çevir`
                      : `${targetLanguage.flag} Şimdi Çevir`}
              </Text>
            )}
          </TouchableOpacity>

          {appMode !== "image" ? (
            <View style={styles.voiceStage}>
              <VoiceStatusCard
                listening={isListening}
                loading={isLoading}
                sourceLabel={`${sourceLanguage.flag} ${sourceLanguage.nativeName}`}
                targetLabel={`${targetLanguage.flag} ${targetLanguage.nativeName}`}
              />

              <TouchableOpacity
                onPress={toggleMicrophone}
                disabled={isLoading}
                activeOpacity={0.9}
                style={styles.voiceRingButton}>
                <VoiceRing listening={isListening} loading={isLoading} />
              </TouchableOpacity>

              <Text style={styles.voiceStageHint}>
                {isListening
                  ? "Konuşmaya devam et, AyTalk seni dinliyor."
                  : isLoading
                    ? "Çeviri hazırlanıyor."
                    : "Konuşmak için mikrofona dokun."}
              </Text>
            </View>
          ) : null}

          {appMode !== "image" ? (
            <View style={styles.waveformCard}>
              <View style={styles.waveformHeader}>
                <View
                  style={[
                    styles.waveformStatusDot,
                    isListening && styles.waveformStatusDotActive,
                  ]}
                />
                <Text style={styles.waveformLabel}>
                  {isListening ? "CANLI SES" : "SES HAZIR"}
                </Text>
              </View>
              <VoiceWaveform active={isListening} />
            </View>
          ) : null}

          <Text style={styles.status}>
            {isLoading
              ? appMode === "assistant"
                ? "AyTalk AI düşünüyor..."
                : `${targetLanguage.nativeName} diline çevriliyor...`
              : isListening
                ? `${sourceLanguage.nativeName} dinliyorum...`
                : appMode === "image"
                  ? selectedImageUri
                    ? "Metni kontrol et ve çeviri butonuna dokun."
                    : "Fotoğraf çek veya galeriden bir görsel seç."
                  : appMode === "conference"
                    ? `${activeConferenceParticipant.name} konuşmaya hazır. Mikrofona dokun.`
                    : `${sourceLanguage.nativeName} konuşmak için mikrofona dokun.`}
          </Text>
          {isLoading ? (
            <Text style={styles.streamingLabel}>● CANLI YANIT</Text>
          ) : null}

          {appMode !== "assistant" ? (
            <Animated.View
              style={[
                styles.resultBox,
                {
                  opacity: resultAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.35, 1],
                  }),
                  transform: [
                    {
                      translateY: resultAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [18, 0],
                      }),
                    },
                    {
                      scale: resultAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.985, 1],
                      }),
                    },
                  ],
                },
              ]}>
              <View style={styles.resultHeader}>
                <View style={styles.resultTitleWrap}>
                  <Text style={styles.resultEyebrow}>ÇEVİRİ SONUCU</Text>
                  <Text style={styles.resultTitle}>
                    {resultLanguage.flag} {resultLanguage.nativeName}
                  </Text>
                </View>
                <View style={styles.resultActions}>
                  <TouchableOpacity
                    onPress={() => shareText(translation)}
                    style={styles.secondaryActionButton}>
                    <Text style={styles.secondaryActionText}>Paylaş</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => speakTranslation(translation, resultLanguage)}
                    style={styles.speakButton}>
                    <Text style={styles.speakButtonText}>Seslendir</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <ScrollView
                style={styles.resultScroll}
                contentContainerStyle={styles.resultScrollContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator>
                <Text style={styles.resultText} selectable>
                  {translation || (isLoading ? "▍" : "Çeviri burada görünecek.")}
                </Text>
              </ScrollView>
            </Animated.View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <RemoteCallScreen
        visible={remoteCallOpen}
        defaultName={remoteCallDefaultName}
        defaultRoomCode={remoteCallRoomCode}
        onClose={() => setRemoteCallOpen(false)}
      />

      <ProfileScreen
        visible={profileOpen}
        usage={{
          translations: translationHistory.length,
          conferences: savedConferenceSessions.length,
          aiMessages: assistantMessages.filter(message => message.role === "user").length,
          favorites: translationHistory.filter(item => item.favorite).length,
        }}
        topLanguages={Object.entries(
          translationHistory.reduce<Record<string, number>>((totals, item) => {
            totals[item.targetLanguage] = (totals[item.targetLanguage] || 0) + 1;
            return totals;
          }, {}),
        )
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([name, count]) => ({name, count}))}
        recentActivities={[
          ...translationHistory.slice(0, 3).map(item => ({
            id: `translation-${item.id}`,
            icon: "🌍",
            title: `${item.sourceLanguage} → ${item.targetLanguage}`,
            detail: item.translatedText.slice(0, 54),
            createdAt: item.createdAt,
          })),
          ...savedConferenceSessions.slice(0, 2).map(session => ({
            id: `conference-${session.id}`,
            icon: "👥",
            title: session.title,
            detail: `${session.participants.length} katılımcı · ${session.messages.length} konuşma`,
            createdAt: session.updatedAt,
          })),
        ]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 5)}
        onClose={() => setProfileOpen(false)}
      />

      <Modal
        visible={liveCameraOpen}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={closeLiveCamera}>
        <View style={styles.liveCameraScreen}>
          {liveCameraDevice ? (
            <Camera
              ref={liveCameraRef}
              style={[
                StyleSheet.absoluteFill,
                liveCameraPosition === "front" && styles.frontCameraMirror,
              ]}
              device={liveCameraDevice}
              format={liveCameraFormat}
              fps={liveCameraFps}
              isActive={liveCameraOpen && appState === "active"}
              photo
              enableZoomGesture
            />
          ) : (
            <View style={styles.liveCameraUnavailable}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.liveCameraUnavailableText}>
                Kamera hazırlanıyor...
              </Text>
            </View>
          )}

          <View style={styles.liveCameraTopBar}>
            <TouchableOpacity
              style={styles.liveCameraCloseButton}
              onPress={closeLiveCamera}>
              <Text style={styles.liveCameraCloseText}>✕</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.liveCameraFlipButton}
              onPress={toggleLiveCameraPosition}>
              <Text style={styles.liveCameraFlipText}>🔄</Text>
            </TouchableOpacity>

            <View style={styles.liveCameraTitleBadge}>
              <View style={styles.liveCameraStatusDot} />
              <View>
                <Text style={styles.liveCameraTitleText}>
                  {videoConversationMode
                    ? "Görüntülü Konuşma"
                    : liveVideoTranslationMode
                      ? "Canlı Video Çeviri"
                      : "AyTalk Kamera"}
                </Text>
                <Text style={styles.liveCameraQualityText}>
                  {liveCameraPosition === "front" ? "Ön kamera" : "Arka kamera"}
                  {" · "}
                  {liveCameraResolutionLabel}
                </Text>
              </View>
            </View>

            <View style={styles.liveCameraTopSpacer} />
          </View>

          {liveVideoTranslationMode ? (
            <>
              <View style={styles.videoLanguageBadge}>
                <Text style={styles.videoLanguageText}>
                  {sourceLanguage.flag} {sourceLanguage.nativeName}
                </Text>
                <Text style={styles.videoLanguageArrow}>→</Text>
                <Text style={styles.videoLanguageText}>
                  {targetLanguage.flag} {targetLanguage.nativeName}
                </Text>
              </View>

              {videoConversationMode ? (
                <View style={styles.videoConversationRoleCard}>
                  <View style={styles.videoConversationPerson}>
                    <Text style={styles.videoConversationFlag}>
                      {sourceLanguage.flag}
                    </Text>
                    <Text style={styles.videoConversationName}>Konuşan</Text>
                    <Text style={styles.videoConversationLanguage}>
                      {sourceLanguage.nativeName}
                    </Text>
                  </View>

                  <View style={styles.videoConversationSwap}>
                    <Text style={styles.videoConversationSwapIcon}>⇄</Text>
                  </View>

                  <View style={styles.videoConversationPerson}>
                    <Text style={styles.videoConversationFlag}>
                      {targetLanguage.flag}
                    </Text>
                    <Text style={styles.videoConversationName}>Dinleyen</Text>
                    <Text style={styles.videoConversationLanguage}>
                      {targetLanguage.nativeName}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.videoSubtitleArea}>
                <View style={styles.videoSubtitleCard}>
                  <Text style={styles.videoSubtitleLabel}>KONUŞMA</Text>
                  <Text style={styles.videoSourceText}>
                    {text.trim() || "Konuşma burada görünecek..."}
                  </Text>
                </View>

                <View style={[styles.videoSubtitleCard, styles.videoTranslationCard]}>
                  <Text style={styles.videoSubtitleLabel}>ÇEVİRİ</Text>
                  <Text style={styles.videoTranslationText}>
                    {translation.trim() || "Çeviri burada görünecek..."}
                  </Text>
                </View>
              </View>

              <View style={styles.videoControls}>
                <TouchableOpacity
                  style={[
                    styles.videoMicButton,
                    isListening && styles.videoMicButtonActive,
                  ]}
                  onPress={toggleMicrophone}
                  disabled={isLoading}>
                  <Text style={styles.videoMicIcon}>
                    {isListening ? "■" : "🎙️"}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.videoControlText}>
                  {isLoading
                    ? "Çeviri hazırlanıyor..."
                    : isListening
                      ? "Dinleniyor — durdurmak için dokun"
                      : videoConversationMode
                        ? "Karşılıklı konuşmayı başlat"
                        : "Konuşmayı başlat"}
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.liveCameraGuide}>
                <View style={styles.liveCameraCornerTopLeft} />
                <View style={styles.liveCameraCornerTopRight} />
                <View style={styles.liveCameraCornerBottomLeft} />
                <View style={styles.liveCameraCornerBottomRight} />
                <Text style={styles.liveCameraGuideText}>
                  Metni çerçevenin içine hizala
                </Text>
              </View>

              <View style={styles.liveCameraBottomBar}>
                <Text style={styles.liveCameraHint}>
                  Net sonuç için telefonu sabit tut
                </Text>

                <TouchableOpacity
                  style={[
                    styles.liveCameraCaptureOuter,
                    isTakingLivePhoto && styles.liveCameraCaptureDisabled,
                  ]}
                  onPress={takeLiveCameraPhoto}
                  disabled={
                    isTakingLivePhoto ||
                    !liveCameraDevice ||
                    appState !== "active"
                  }>
                  <View style={styles.liveCameraCaptureInner}>
                    {isTakingLivePhoto ? (
                      <ActivityIndicator size="small" color="#0D4FA8" />
                    ) : null}
                  </View>
                </TouchableOpacity>

                <Text style={styles.liveCameraCaptureLabel}>
                  {isTakingLivePhoto ? "İşleniyor..." : "Fotoğraf çek"}
                </Text>
              </View>
            </>
          )}
        </View>
      </Modal>

      <Modal
        visible={historyOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.historyModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Çeviri Geçmişi</Text>
              <TouchableOpacity
                onPress={() => setHistoryOpen(false)}
                style={styles.closeButton}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.historyTopRow}>
              <Text style={styles.historyCount}>
                {translationHistory.length} kayıt
              </Text>
              {translationHistory.length > 0 ? (
                <TouchableOpacity onPress={clearTranslationHistory}>
                  <Text style={styles.deleteHistoryText}>Tümünü sil</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView showsVerticalScrollIndicator>
              {translationHistory.length === 0 ? (
                <Text style={styles.emptyHistoryText}>
                  Henüz kayıtlı çeviri yok.
                </Text>
              ) : (
                translationHistory.map(item => (
                  <View key={item.id} style={styles.historyCard}>
                    <View style={styles.historyCardHeader}>
                      <Text style={styles.historyLanguages}>
                        {item.sourceLanguage} → {item.targetLanguage}
                      </Text>
                      <TouchableOpacity onPress={() => toggleFavorite(item.id)}>
                        <Text style={styles.favoriteIcon}>
                          {item.favorite ? "★" : "☆"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.historySource} selectable>
                      {item.sourceText}
                    </Text>
                    <Text style={styles.historyTranslation} selectable>
                      {item.translatedText}
                    </Text>

                    <View style={styles.historyActions}>
                      <TouchableOpacity
                        style={styles.historyActionButton}
                        onPress={() => shareText(item.translatedText)}>
                        <Text style={styles.historyActionText}>Paylaş</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.historyActionButton}
                        onPress={() => {
                          const language =
                            LANGUAGES.find(lang => lang.name === item.targetLanguage) ||
                            resultLanguage;
                          void speakTranslation(item.translatedText, language);
                        }}>
                        <Text style={styles.historyActionText}>Seslendir</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.historyActionButton}
                        onPress={() => {
                          const source =
                            LANGUAGES.find(lang => lang.name === item.sourceLanguage) ||
                            sourceLanguage;
                          const target =
                            LANGUAGES.find(lang => lang.name === item.targetLanguage) ||
                            targetLanguage;
                          setSourceLanguage(source);
                          setTargetLanguage(target);
                          setText(item.sourceText);
                          setTranslation(item.translatedText);
                          setResultLanguage(target);
                          setHistoryOpen(false);
                          setAppMode("translate");
                        }}>
                        <Text style={styles.historyActionText}>Aç</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={conferenceTitleModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConferenceTitleModalOpen(false)}>
        <View style={styles.nameModalBackdrop}>
          <View style={styles.nameModalCard}>
            <Text style={styles.nameModalTitle}>Toplantı adını değiştir</Text>
            <TextInput
              style={styles.nameModalInput}
              value={conferenceTitleDraft}
              onChangeText={setConferenceTitleDraft}
              placeholder="Toplantı adı"
              placeholderTextColor={UI.colors.textSoft}
              maxLength={50}
              autoFocus
            />
            <View style={styles.nameModalActions}>
              <TouchableOpacity style={styles.nameModalCancelButton} onPress={() => setConferenceTitleModalOpen(false)}>
                <Text style={styles.nameModalCancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.nameModalSaveButton} onPress={saveConferenceTitle}>
                <Text style={styles.nameModalSaveText}>Kaydet</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={conferenceHistoryOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setConferenceHistoryOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.historyModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Kayıtlı Toplantılar</Text>
              <TouchableOpacity onPress={() => setConferenceHistoryOpen(false)} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.historyCount}>Son {savedConferenceSessions.length} / 20 toplantı</Text>
            <ScrollView showsVerticalScrollIndicator>
              {savedConferenceSessions.length === 0 ? (
                <Text style={styles.emptyHistoryText}>Henüz kayıtlı toplantı yok.</Text>
              ) : (
                savedConferenceSessions.map(session => (
                  <View key={session.id} style={styles.savedMeetingCard}>
                    <Text style={styles.savedMeetingTitle}>{session.title}</Text>
                    <Text style={styles.savedMeetingMeta}>
                      {new Date(session.updatedAt).toLocaleString()} · {session.participants.length} katılımcı · {session.messages.length} konuşma
                    </Text>
                    <View style={styles.savedMeetingActions}>
                      <TouchableOpacity style={styles.historyActionButton} onPress={() => loadConferenceSession(session)}>
                        <Text style={styles.historyActionText}>Aç</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.savedMeetingDeleteButton} onPress={() => deleteConferenceSession(session.id)}>
                        <Text style={styles.savedMeetingDeleteText}>Sil</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <LanguagePicker
        visible={sourcePickerOpen}
        title={appMode === "assistant" ? "Asistan dilini seç" : appMode === "image" ? "Görseldeki dili seç" : "Konuşulan dili seç"}
        selected={sourceLanguage}
        onSelect={setSourceLanguage}
        onClose={() => setSourcePickerOpen(false)}
      />
      <Modal
        visible={conferenceNameModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConferenceNameModalOpen(false)}>
        <View style={styles.nameModalBackdrop}>
          <View style={styles.nameModalCard}>
            <Text style={styles.nameModalTitle}>Katılımcı adını değiştir</Text>
            <TextInput
              style={styles.nameModalInput}
              value={conferenceNameDraft}
              onChangeText={setConferenceNameDraft}
              placeholder="Katılımcı adı"
              placeholderTextColor={UI.colors.textSoft}
              maxLength={24}
              autoFocus
            />
            <View style={styles.nameModalActions}>
              <TouchableOpacity
                style={styles.nameModalCancelButton}
                onPress={() => setConferenceNameModalOpen(false)}>
                <Text style={styles.nameModalCancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.nameModalSaveButton}
                onPress={saveConferenceParticipantName}>
                <Text style={styles.nameModalSaveText}>Kaydet</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <LanguagePicker
        visible={conferencePickerOpen}
        title={`${activeConferenceParticipant.name} dilini seç`}
        selected={activeConferenceParticipant.language}
        onSelect={updateActiveConferenceLanguage}
        onClose={() => setConferencePickerOpen(false)}
      />
      <LanguagePicker
        visible={targetPickerOpen}
        title="Çevrilecek dili seç"
        selected={targetLanguage}
        onSelect={setTargetLanguage}
        onClose={() => setTargetPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const UI = {
  colors: {
    background: "#050A18",
    surface: "#0B1730",
    surfaceSoft: "#0E1C39",
    surfaceMuted: "#132341",
    navy: "#050A18",
    navySoft: "#E6F3FF",
    primary: "#1E56FF",
    primaryDark: "#0B63CE",
    primarySoft: "#132E62",
    cyan: "#4BC6FF",
    text: "#FFFFFF",
    textMuted: "#AFC7E6",
    textSoft: "#7F9AB9",
    border: "#20365C",
    success: "#32D583",
    successSoft: "#0D2E2A",
    danger: "#FF5C6C",
    warning: "#F5B83D",
    white: "#FFFFFF",
  },
  radius: {
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 28,
    pill: 999,
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
  },
} as const;

const cardShadow = {
  shadowColor: UI.colors.navy,
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: {width: 0, height: 6},
  elevation: 3,
};

const styles = StyleSheet.create({
  permissionBoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#030817",
  },
  permissionBootLogo: {
    width: 250,
    height: 160,
    resizeMode: "contain",
    marginBottom: 20,
  },
  featurePageHeader: {
    width: "100%",
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  featureBackButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B1730",
    borderWidth: 1,
    borderColor: "#20365C",
  },
  featureBackText: {
    color: "#FFFFFF",
    fontSize: 32,
    lineHeight: 33,
    marginTop: -4,
  },
  featurePageTitleWrap: {
    flex: 1,
    alignItems: "center",
  },
  featurePageTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
  },
  featurePageEnglish: {
    color: "#4BC6FF",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 2,
  },
  featureHeaderSpacer: {
    width: 42,
  },
  hiddenOldHeader: {
    display: "none",
  },
  hiddenLegacyNav: {
    display: "none",
  },
  permissionBackdropNew: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "rgba(2,6,16,0.94)",
  },
  permissionCardNew: {
    borderRadius: 28,
    padding: 20,
    backgroundColor: "#0B1730",
    borderWidth: 1,
    borderColor: "#315FA8",
  },
  permissionLogoNew: {
    width: "100%",
    height: 120,
    resizeMode: "contain",
  },
  permissionTitleNew: {
    color: "#FFFFFF",
    fontSize: 23,
    fontWeight: "900",
    marginTop: 4,
  },
  permissionTextNew: {
    color: "#91A7C2",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 7,
  },
  permissionItemsNew: {
    marginTop: 14,
    gap: 9,
  },
  permissionItemNew: {
    color: "#C7D7EA",
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: "#0E1C39",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  permissionButtonNew: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#1E56FF",
    marginTop: 17,
  },
  permissionButtonTextNew: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  container: {
    flex: 1,
    backgroundColor: UI.colors.background,
  },
  keyboardArea: {
    flex: 1,
  },
  pageScroll: {
    flex: 1,
  },
  pageContent: {
    alignItems: "center",
    paddingHorizontal: UI.spacing.md,
    paddingTop: UI.spacing.sm,
    paddingBottom: 60,
  },

  brandCard: {
    width: "100%",
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: UI.colors.navy,
    borderRadius: UI.radius.xxl,
    paddingHorizontal: UI.spacing.md,
    paddingVertical: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#1D4D8F",
    shadowColor: UI.colors.navy,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 8},
    elevation: 7,
  },
  brandLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  logo: {
    width: 68,
    height: 54,
    resizeMode: "contain",
  },
  brandTextWrap: {
    flex: 1,
    minWidth: 0,
    marginLeft: 7,
  },
  brandTitle: {
    fontSize: 25,
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  brandSubtitle: {
    fontSize: 11,
    lineHeight: 15,
    color: "#AFC7E6",
    marginTop: 2,
  },
  readyBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50,213,131,0.14)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    marginLeft: 8,
  },
  readyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#1FAD72",
    marginRight: 5,
  },
  readyText: {
    fontSize: 11,
    color: "#7EE2AE",
    fontWeight: "800",
  },

  modeTabs: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    backgroundColor: UI.colors.surfaceMuted,
    borderRadius: UI.radius.lg,
    padding: 5,
    marginBottom: UI.spacing.sm,
    borderWidth: 1,
    borderColor: UI.colors.border,
    gap: 5,
  },
  modeTab: {
    width: "48.8%",
    minHeight: 46,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 5,
  },
  modeTabActive: {
    backgroundColor: UI.colors.primary,
    shadowColor: UI.colors.primary,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 3},
    elevation: 2,
  },
  modeTabText: {
    width: "100%",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
    color: UI.colors.textMuted,
    fontWeight: "800",
    flexShrink: 1,
  },
  modeTabTextActive: {
    color: "#FFFFFF",
  },

  quickActions: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: 7,
    marginBottom: 10,
  },
  quickActionButton: {
    minWidth: "31%",
    flexGrow: 1,
    maxWidth: "49%",
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(14,28,57,0.94)",
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: UI.colors.border,
  },
  quickActionText: {
    width: "100%",
    textAlign: "center",
    fontSize: 12,
    color: UI.colors.primaryDark,
    fontWeight: "800",
    flexShrink: 1,
  },

  languagePanel: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  languageButton: {
    flex: 1,
    backgroundColor: UI.colors.surface,
    borderWidth: 1,
    borderColor: UI.colors.border,
    borderRadius: UI.radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    ...cardShadow,
  },
  selectorLabel: {
    fontSize: 11,
    color: UI.colors.textMuted,
    marginBottom: 5,
    fontWeight: "600",
  },
  selectorValue: {
    fontSize: 16,
    color: UI.colors.navySoft,
    fontWeight: "800",
  },
  swapButton: {
    width: 48,
    height: 48,
    borderRadius: UI.radius.xl,
    backgroundColor: UI.colors.primaryDark,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: UI.colors.primaryDark,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 4},
    elevation: 3,
  },
  swapButtonText: {
    fontSize: 24,
    color: "#FFFFFF",
    fontWeight: "800",
  },

  voiceStyleRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: UI.colors.surface,
    borderRadius: UI.radius.lg,
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: UI.colors.border,
  },
  voiceStyleTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  voiceStyleTitle: {
    fontSize: 14,
    color: UI.colors.navySoft,
    fontWeight: "900",
  },
  voiceStyleDescription: {
    fontSize: 11,
    lineHeight: 16,
    color: UI.colors.textMuted,
    marginTop: 2,
  },

  conversationRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: UI.colors.surface,
    borderRadius: UI.radius.lg,
    paddingHorizontal: 15,
    paddingVertical: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: UI.colors.border,
  },
  modeTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  conversationTitle: {
    fontSize: 15,
    color: UI.colors.navySoft,
    fontWeight: "800",
  },
  modeDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: UI.colors.textMuted,
    marginTop: 2,
  },

  imageToolsCard: {
    width: "100%",
    backgroundColor: UI.colors.surface,
    borderRadius: UI.radius.xl,
    padding: 17,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: UI.colors.border,
    ...cardShadow,
  },
  imageToolsHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 13,
  },
  imageToolsHeaderText: {
    flex: 1,
    marginRight: 10,
  },
  imageToolsTitle: {
    fontSize: 18,
    color: UI.colors.navySoft,
    fontWeight: "900",
  },
  imageToolsDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: UI.colors.textMuted,
    marginTop: 3,
  },
  ocrBadge: {
    backgroundColor: UI.colors.successSoft,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  ocrBadgeText: {
    fontSize: 11,
    color: UI.colors.success,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  imageActionRow: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 9,
  },
  imageActionButton: {
    width: "48.5%",
    minWidth: 130,
    flexGrow: 1,
    minHeight: 108,
    backgroundColor: UI.colors.surfaceSoft,
    borderRadius: 19,
    paddingHorizontal: 9,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: UI.colors.border,
    overflow: "hidden",
  },
  imageActionIcon: {
    fontSize: 30,
    marginBottom: 6,
  },
  imageActionTitle: {
    width: "100%",
    textAlign: "center",
    fontSize: 14,
    lineHeight: 18,
    color: UI.colors.navySoft,
    fontWeight: "900",
    flexShrink: 1,
  },
  imageActionSubtitle: {
    width: "100%",
    textAlign: "center",
    fontSize: 10,
    color: UI.colors.textSoft,
    marginTop: 3,
    flexShrink: 1,
  },
  previewWrap: {
    marginTop: 13,
    borderRadius: 19,
    overflow: "hidden",
    backgroundColor: UI.colors.surfaceMuted,
    position: "relative",
  },
  imagePreview: {
    width: "100%",
    height: 230,
    resizeMode: "contain",
  },
  removeImageButton: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 34,
    height: 34,
    borderRadius: 19,
    backgroundColor: "rgba(13,59,130,0.88)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeImageText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  ocrUtilityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 11,
  },
  ocrSourceBadge: {
    backgroundColor: UI.colors.successSoft,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  ocrSourceBadgeText: {
    fontSize: 11,
    color: UI.colors.success,
    fontWeight: "900",
  },
  cloudReadButton: {
    flex: 1,
    backgroundColor: UI.colors.primarySoft,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  cloudReadButtonText: {
    fontSize: 12,
    color: UI.colors.primaryDark,
    fontWeight: "900",
  },

  ocrLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    marginTop: 10,
  },
  ocrLoadingText: {
    fontSize: 13,
    color: UI.colors.textMuted,
    fontWeight: "700",
    marginLeft: 9,
  },

  assistantHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: UI.colors.surface,
    borderRadius: 18,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: UI.colors.border,
  },
  assistantHeaderText: {
    flex: 1,
    marginRight: 10,
  },
  assistantTitle: {
    fontSize: 18,
    color: UI.colors.navySoft,
    fontWeight: "900",
  },
  assistantDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: UI.colors.textMuted,
    marginTop: 3,
  },
  smallLanguageButton: {
    backgroundColor: UI.colors.primaryDark,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  smallLanguageButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },

  chatArea: {
    width: "100%",
    marginBottom: 10,
  },
  chatBubble: {
    maxWidth: "92%",
    borderRadius: UI.radius.xl,
    padding: 17,
    marginBottom: 10,
    borderWidth: 1,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: UI.colors.primarySoft,
    borderColor: "#CFE6FF",
    borderBottomRightRadius: 7,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: UI.colors.surface,
    borderColor: UI.colors.border,
    borderBottomLeftRadius: 7,
  },
  chatRole: {
    fontSize: 11,
    color: UI.colors.primaryDark,
    fontWeight: "900",
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  chatText: {
    fontSize: 16,
    lineHeight: 24,
    color: UI.colors.text,
  },
  inlineSpeakButton: {
    alignSelf: "flex-start",
    marginTop: 10,
    backgroundColor: UI.colors.primaryDark,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  inlineSpeakText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  clearChatButton: {
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 4,
  },
  clearChatText: {
    color: UI.colors.textMuted,
    fontSize: 13,
    textDecorationLine: "underline",
  },

  inputTopRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
    marginBottom: 7,
    paddingHorizontal: 3,
  },
  sectionLabel: {
    fontSize: 13,
    color: UI.colors.textMuted,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  characterCount: {
    fontSize: 12,
    color: UI.colors.textSoft,
  },
  input: {
    width: "100%",
    minHeight: 122,
    backgroundColor: UI.colors.surface,
    borderWidth: 1,
    borderColor: UI.colors.border,
    borderRadius: 22,
    padding: 17,
    fontSize: 17,
    lineHeight: 27,
    color: "#FFFFFF",
    textAlignVertical: "top",
    ...cardShadow,
  },

  primaryButton: {
    width: "100%",
    minHeight: 56,
    borderRadius: UI.radius.lg,
    backgroundColor: UI.colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
    paddingHorizontal: 12,
    shadowColor: UI.colors.primary,
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 5},
    elevation: 4,
  },
  disabledButton: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.1,
  },

  loadingContent: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingDots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 14,
    gap: 7,
  },
  loadingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: UI.colors.surface,
  },
  loadingText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 5,
    letterSpacing: 0.2,
  },

  voiceStage: {
    width: "100%",
    alignItems: "center",
    backgroundColor: "#081329",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#20365C",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 16,
    marginTop: 12,
    overflow: "hidden",
  },
  voiceRingButton: {
    borderRadius: 100,
  },
  voiceStageHint: {
    color: "#AFC7E6",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 2,
    paddingHorizontal: 10,
  },
  micButton: {
    marginTop: 10,
    borderRadius: 80,
  },
  micAnimatedWrap: {
    borderRadius: 80,
    backgroundColor: UI.colors.surface,
    padding: 3,
    shadowColor: UI.colors.primaryDark,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 5},
    elevation: 3,
  },
  micButtonListening: {
    shadowColor: "#E53935",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  mic: {
    width: 116,
    height: 116,
    resizeMode: "contain",
  },
  waveformCard: {
    width: "100%",
    minHeight: 92,
    borderRadius: 18,
    backgroundColor: "#0B1730",
    borderWidth: 1,
    borderColor: "#20365C",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    marginTop: 10,
    overflow: "hidden",
  },
  waveformHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  waveformStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#526784",
    marginRight: 7,
  },
  waveformStatusDotActive: {
    backgroundColor: "#32D583",
    shadowColor: "#32D583",
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: {width: 0, height: 0},
    elevation: 3,
  },
  waveformLabel: {
    color: "#AFC7E6",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  status: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    color: UI.colors.textMuted,
    marginTop: 4,
  },

  streamingLabel: {
    fontSize: 10,
    color: "#1FAD72",
    fontWeight: "900",
    letterSpacing: 1.1,
    marginTop: 3,
  },

  resultBox: {
    width: "100%",
    minHeight: 125,
    backgroundColor: UI.colors.surface,
    borderRadius: UI.radius.xl,
    padding: 18,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: UI.colors.border,
    shadowColor: UI.colors.navy,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 5},
    elevation: 2,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 11,
  },
  resultTitleWrap: {
    flex: 1,
    marginRight: 8,
  },
  resultEyebrow: {
    fontSize: 10,
    color: UI.colors.textSoft,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginBottom: 3,
  },
  resultActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  secondaryActionButton: {
    backgroundColor: UI.colors.primarySoft,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secondaryActionText: {
    color: UI.colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
  },
  resultTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: UI.colors.navySoft,
  },
  resultScroll: {
    maxHeight: 360,
  },
  resultScrollContent: {
    paddingBottom: 4,
  },
  resultText: {
    fontSize: 20,
    lineHeight: 30,
    color: UI.colors.text,
  },
  speakButton: {
    backgroundColor: UI.colors.primaryDark,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  speakButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },

  liveCameraLaunchButton: {
    width: "100%",
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: UI.colors.primaryDark,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 11,
    shadowColor: UI.colors.primaryDark,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 5},
    elevation: 4,
  },
  liveCameraLaunchIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  liveCameraLaunchIcon: {
    fontSize: 23,
  },
  liveCameraLaunchTextWrap: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
    marginRight: 7,
  },
  liveCameraLaunchTitle: {
    width: "100%",
    fontSize: 14,
    lineHeight: 18,
    color: "#FFFFFF",
    fontWeight: "900",
    flexShrink: 1,
  },
  liveCameraLaunchSubtitle: {
    width: "100%",
    fontSize: 10,
    lineHeight: 15,
    color: "#D9E7FF",
    flexShrink: 1,
    marginTop: 2,
  },
  liveCameraLaunchArrow: {
    fontSize: 30,
    color: "#FFFFFF",
    fontWeight: "300",
    marginLeft: 7,
  },
  liveVideoLaunchButton: {
    borderColor: "#315FA8",
    backgroundColor: "#10254B",
  },
  liveVideoLaunchIconWrap: {
    backgroundColor: "#193D75",
  },
  videoConversationLaunchButton: {
    borderColor: "#5E4BB8",
    backgroundColor: "#161B46",
  },
  videoConversationIconWrap: {
    backgroundColor: "#33286F",
  },
  liveCameraScreen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  liveCameraUnavailable: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050A18",
  },
  liveCameraUnavailableText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 12,
  },
  liveCameraTopBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    minHeight: 94,
    paddingTop: 28,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.30)",
  },
  liveCameraCloseButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(0,0,0,0.48)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  liveCameraCloseText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
  },
  liveCameraFlipButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(0,0,0,0.48)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(75,198,255,0.45)",
  },
  liveCameraFlipText: {
    fontSize: 22,
  },
  frontCameraMirror: {
    transform: [{scaleX: -1}],
  },
  liveCameraTitleBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.48)",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
  },
  liveCameraStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#32D583",
    marginRight: 7,
  },
  liveCameraTitleText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  liveCameraQualityText: {
    color: "#AFC7E6",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 2,
  },
  liveCameraTopSpacer: {
    width: 46,
  },
  liveCameraGuide: {
    position: "absolute",
    left: 30,
    right: 30,
    top: "24%",
    height: "42%",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 18,
  },
  liveCameraCornerTopLeft: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 44,
    height: 44,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: "#FFFFFF",
    borderTopLeftRadius: 8,
  },
  liveCameraCornerTopRight: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderColor: "#FFFFFF",
    borderTopRightRadius: 8,
  },
  liveCameraCornerBottomLeft: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 44,
    height: 44,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: "#FFFFFF",
    borderBottomLeftRadius: 8,
  },
  liveCameraCornerBottomRight: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 44,
    height: 44,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderColor: "#FFFFFF",
    borderBottomRightRadius: 8,
  },
  liveCameraGuideText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    backgroundColor: "rgba(0,0,0,0.50)",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
    overflow: "hidden",
  },
  liveCameraBottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 192,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 25,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  liveCameraHint: {
    color: "#E6ECF5",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 14,
  },
  liveCameraCaptureOuter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  liveCameraCaptureInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: UI.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  liveCameraCaptureDisabled: {
    opacity: 0.62,
  },
  liveCameraCaptureLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 10,
  },
  videoLanguageBadge: {
    position: "absolute",
    top: 88,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(5,10,24,0.84)",
    borderWidth: 1,
    borderColor: "rgba(75,198,255,0.45)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  videoLanguageText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  videoLanguageArrow: {
    color: "#4BC6FF",
    fontSize: 17,
    fontWeight: "900",
    marginHorizontal: 10,
  },
  videoConversationRoleCard: {
    position: "absolute",
    top: 132,
    left: 14,
    right: 14,
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(5,10,24,0.82)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(139,92,255,0.50)",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  videoConversationPerson: {
    flex: 1,
    alignItems: "center",
  },
  videoConversationFlag: {
    fontSize: 26,
  },
  videoConversationName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 4,
  },
  videoConversationLanguage: {
    color: "#AFC7E6",
    fontSize: 10,
    marginTop: 2,
  },
  videoConversationSwap: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  videoConversationSwapIcon: {
    color: "#8B5CFF",
    fontSize: 26,
    fontWeight: "900",
  },
  videoSubtitleArea: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 142,
    gap: 10,
  },
  videoSubtitleCard: {
    backgroundColor: "rgba(5,10,24,0.84)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  videoTranslationCard: {
    borderColor: "rgba(75,198,255,0.55)",
    backgroundColor: "rgba(8,31,63,0.90)",
  },
  videoSubtitleLabel: {
    color: "#7F9AB9",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  videoSourceText: {
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
  },
  videoTranslationText: {
    color: "#9FE6FF",
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "900",
  },
  videoControls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: "center",
  },
  videoMicButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E56FF",
    borderWidth: 3,
    borderColor: "#7EDCFF",
    shadowColor: "#4BC6FF",
    shadowOpacity: 0.65,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 0},
    elevation: 8,
  },
  videoMicButtonActive: {
    backgroundColor: "#C73B47",
    borderColor: "#FF9AA5",
  },
  videoMicIcon: {
    fontSize: 27,
  },
  videoControlText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 9,
    backgroundColor: "rgba(5,10,24,0.74)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },

  conferenceCard: {
    width: "100%",
    backgroundColor: UI.colors.surface,
    borderRadius: UI.radius.xl,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: UI.colors.border,
    ...cardShadow,
  },
  conferenceHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  conferenceHeaderText: {flex: 1, marginRight: 10},
  conferenceTitle: {fontSize: 20, fontWeight: "900", color: UI.colors.navySoft},
  conferenceDescription: {fontSize: 12, lineHeight: 18, color: UI.colors.textMuted, marginTop: 4},
  conferenceLiveBadge: {backgroundColor: UI.colors.successSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6},
  conferenceLiveText: {fontSize: 10, fontWeight: "900", color: UI.colors.success, letterSpacing: 0.8},
  conferenceSessionActions: {flexDirection: "row", gap: 8, marginBottom: 12},
  conferenceSessionButton: {flex: 1, backgroundColor: UI.colors.primarySoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10, alignItems: "center"},
  conferenceSessionButtonText: {fontSize: 11, fontWeight: "900", color: UI.colors.primaryDark},
  conferenceAutomationCard: {
    backgroundColor: UI.colors.surfaceSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI.colors.border,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  conferenceAutomationRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  conferenceAutomationTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  conferenceAutomationTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: UI.colors.navySoft,
  },
  conferenceAutomationDescription: {
    fontSize: 11,
    lineHeight: 16,
    color: UI.colors.textMuted,
    marginTop: 2,
  },
  conferenceAutomationDivider: {
    height: 1,
    backgroundColor: UI.colors.border,
  },
  participantGrid: {flexDirection: "row", flexWrap: "wrap", gap: 8},
  participantCard: {
    width: "48%", minHeight: 92, borderRadius: 16, padding: 12,
    backgroundColor: UI.colors.surfaceSoft, borderWidth: 1, borderColor: UI.colors.border,
  },
  participantCardActive: {backgroundColor: UI.colors.primary, borderColor: UI.colors.primary},
  participantAvatar: {fontSize: 25, marginBottom: 5},
  participantName: {fontSize: 14, fontWeight: "900", color: UI.colors.navySoft},
  participantNameActive: {color: UI.colors.white},
  participantLanguage: {fontSize: 11, color: UI.colors.textMuted, marginTop: 2},
  participantLanguageActive: {color: "#DCEBFF"},
  conferenceActiveRow: {
    flexDirection: "row", alignItems: "center", marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: UI.colors.border,
  },
  conferenceActiveInfo: {flex: 1, marginRight: 8},
  conferenceActiveLabel: {fontSize: 10, fontWeight: "800", color: UI.colors.textSoft},
  conferenceActiveValue: {fontSize: 14, fontWeight: "900", color: UI.colors.navySoft, marginTop: 3},
  conferenceLanguageButton: {backgroundColor: UI.colors.primarySoft, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 9},
  conferenceLanguageButtonText: {fontSize: 11, fontWeight: "900", color: UI.colors.primaryDark},
  conferenceDirectionCard: {backgroundColor: UI.colors.surfaceSoft, borderRadius: 16, padding: 12, marginTop: 12, borderWidth: 1, borderColor: UI.colors.border},
  conferenceDirectionHeader: {flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 9},
  conferenceDirectionTitle: {fontSize: 13, fontWeight: "900", color: UI.colors.navySoft},
  conferenceDirectionSwapButton: {backgroundColor: UI.colors.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7},
  conferenceDirectionSwapText: {fontSize: 11, fontWeight: "900", color: UI.colors.primaryDark},
  listenerChip: {minWidth: 104, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 10, marginRight: 8, backgroundColor: UI.colors.surface, borderWidth: 1, borderColor: UI.colors.border},
  listenerChipActive: {backgroundColor: UI.colors.primaryDark, borderColor: UI.colors.primaryDark},
  listenerChipFlag: {fontSize: 22, marginBottom: 4},
  listenerChipName: {fontSize: 12, fontWeight: "900", color: UI.colors.navySoft},
  listenerChipNameActive: {color: UI.colors.white},
  listenerChipLanguage: {fontSize: 10, color: UI.colors.textMuted, marginTop: 2},
  listenerChipLanguageActive: {color: "#DCEBFF"},
  conferenceDirectionSummary: {fontSize: 11, fontWeight: "800", color: UI.colors.textMuted, marginTop: 9},
  conferenceManageRow: {flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10},
  multiPartyCard: {
    backgroundColor: UI.colors.surfaceSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI.colors.border,
    padding: 12,
    marginTop: 12,
  },
  multiPartyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  multiPartyTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  multiPartyTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: UI.colors.navySoft,
  },
  multiPartyDescription: {
    fontSize: 11,
    lineHeight: 16,
    color: UI.colors.textMuted,
    marginTop: 3,
  },
  nextSpeakerLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: UI.colors.textSoft,
    marginTop: 12,
    marginBottom: 8,
  },
  nextSpeakerChip: {
    minWidth: 108,
    backgroundColor: UI.colors.surface,
    borderWidth: 1,
    borderColor: UI.colors.border,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginRight: 8,
  },
  nextSpeakerFlag: {
    fontSize: 22,
    marginBottom: 4,
  },
  nextSpeakerName: {
    fontSize: 12,
    fontWeight: "900",
    color: UI.colors.navySoft,
  },
  nextSpeakerLanguage: {
    fontSize: 10,
    color: UI.colors.textMuted,
    marginTop: 2,
  },
  conferenceManageButton: {flexGrow: 1, backgroundColor: UI.colors.primarySoft, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 9, alignItems: "center"},
  conferenceManageButtonText: {fontSize: 11, fontWeight: "900", color: UI.colors.primaryDark},
  conferenceRemoveButton: {backgroundColor: "#FDECEF", borderRadius: 11, paddingHorizontal: 10, paddingVertical: 9, alignItems: "center"},
  conferenceRemoveButtonText: {fontSize: 11, fontWeight: "900", color: UI.colors.danger},
  conferenceTranscript: {marginTop: 16},
  conferenceTranscriptHeader: {flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8},
  conferenceTranscriptTitle: {fontSize: 16, fontWeight: "900", color: UI.colors.navySoft},
  conferenceTranscriptActions: {flexDirection: "row", alignItems: "center", gap: 14},
  conferenceShareText: {fontSize: 12, fontWeight: "900", color: UI.colors.primaryDark},
  conferenceClearText: {fontSize: 12, fontWeight: "800", color: UI.colors.danger},
  conferenceMessageCard: {backgroundColor: UI.colors.surfaceSoft, borderRadius: 16, padding: 13, marginBottom: 9, borderWidth: 1, borderColor: UI.colors.border},
  conferenceSpeaker: {fontSize: 12, fontWeight: "900", color: UI.colors.primaryDark, marginBottom: 5},
  conferenceOriginal: {fontSize: 14, lineHeight: 21, color: UI.colors.textMuted},
  conferenceTranslated: {fontSize: 17, lineHeight: 25, fontWeight: "700", color: UI.colors.text, marginTop: 7},
  conferenceSpeakButton: {alignSelf: "flex-start", backgroundColor: UI.colors.primaryDark, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6, marginTop: 8},
  conferenceSpeakText: {fontSize: 11, fontWeight: "800", color: UI.colors.white},

  savedMeetingCard: {backgroundColor: UI.colors.surfaceSoft, borderRadius: 17, padding: 14, marginTop: 10, borderWidth: 1, borderColor: UI.colors.border},
  savedMeetingTitle: {fontSize: 17, fontWeight: "900", color: UI.colors.navySoft},
  savedMeetingMeta: {fontSize: 11, lineHeight: 17, color: UI.colors.textMuted, marginTop: 5},
  savedMeetingActions: {flexDirection: "row", gap: 8, marginTop: 11},
  savedMeetingDeleteButton: {backgroundColor: "#FDECEF", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7},
  savedMeetingDeleteText: {fontSize: 12, fontWeight: "900", color: UI.colors.danger},
  nameModalBackdrop: {flex: 1, backgroundColor: "rgba(4,15,32,0.68)", alignItems: "center", justifyContent: "center", padding: 22},
  nameModalCard: {width: "100%", maxWidth: 420, backgroundColor: UI.colors.surface, borderRadius: 24, padding: 20},
  nameModalTitle: {fontSize: 20, fontWeight: "900", color: UI.colors.navySoft, marginBottom: 14},
  nameModalInput: {minHeight: 52, borderWidth: 1, borderColor: UI.colors.border, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: UI.colors.text, backgroundColor: UI.colors.surfaceSoft},
  nameModalActions: {flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16},
  nameModalCancelButton: {paddingHorizontal: 15, paddingVertical: 11, borderRadius: 12, backgroundColor: UI.colors.surfaceMuted},
  nameModalCancelText: {fontSize: 13, fontWeight: "800", color: UI.colors.textMuted},
  nameModalSaveButton: {paddingHorizontal: 17, paddingVertical: 11, borderRadius: 12, backgroundColor: UI.colors.primary},
  nameModalSaveText: {fontSize: 13, fontWeight: "900", color: UI.colors.white},

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(4,15,32,0.68)",
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "82%",
    backgroundColor: UI.colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
  },
  historyModalCard: {
    height: "86%",
    backgroundColor: UI.colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
  },
  historyTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  historyCount: {
    fontSize: 13,
    color: UI.colors.textMuted,
  },
  deleteHistoryText: {
    fontSize: 13,
    color: UI.colors.danger,
    fontWeight: "800",
  },
  emptyHistoryText: {
    textAlign: "center",
    color: UI.colors.textMuted,
    fontSize: 15,
    marginTop: 40,
  },
  historyCard: {
    backgroundColor: UI.colors.surfaceSoft,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: UI.colors.border,
  },
  historyCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  historyLanguages: {
    fontSize: 13,
    color: UI.colors.primaryDark,
    fontWeight: "900",
  },
  favoriteIcon: {
    fontSize: 28,
    color: UI.colors.warning,
  },
  historySource: {
    fontSize: 15,
    lineHeight: 22,
    color: UI.colors.textMuted,
    marginBottom: 8,
  },
  historyTranslation: {
    fontSize: 16,
    lineHeight: 24,
    color: UI.colors.text,
    fontWeight: "600",
  },
  historyActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  historyActionButton: {
    backgroundColor: UI.colors.primaryDark,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  historyActionText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: UI.colors.navySoft,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 19,
    backgroundColor: UI.colors.primarySoft,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    fontSize: 18,
    color: UI.colors.primaryDark,
  },
  languageRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 15,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  languageRowActive: {
    backgroundColor: UI.colors.primarySoft,
  },
  languageFlag: {
    fontSize: 30,
    marginRight: 12,
  },
  languageTextWrap: {
    flex: 1,
  },
  languageNative: {
    fontSize: 18,
    fontWeight: "800",
    color: UI.colors.text,
  },
  languageEnglish: {
    fontSize: 13,
    color: "#AFC7E6",
    marginTop: 2,
  },
  check: {
    fontSize: 22,
    color: UI.colors.cyan,
    fontWeight: "900",
  },
});

export default function App() {
  const [introVisible, setIntroVisible] = useState(true);

  return (
    <SafeAreaProvider>
      {introVisible ? (
        <AppIntro onFinish={() => setIntroVisible(false)} />
      ) : (
        <AyTalkMainApp />
      )}
    </SafeAreaProvider>
  );
}

