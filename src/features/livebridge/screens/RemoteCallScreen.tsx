import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Buffer} from "buffer";
import {
  ActivityIndicator,
  FlatList,
  ListRenderItem,
  Alert,
  Modal,
  NativeModules,
  PermissionsAndroid,
  Platform,
  PanResponder,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  RoomAudioRenderer,
  TrackReferenceOrPlaceholder,
  useLocalParticipant,
  useRoomContext,
  useTracks,
  VideoTrack,
} from "@livekit/react-native";
import {useKeepAwake} from "@sayem314/react-native-keep-awake";
import {AudioPresets, RoomEvent, Track} from "livekit-client";
import Tts from "react-native-tts";
import Sound from "react-native-sound";
import Contacts from "react-native-contacts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import messaging from "@react-native-firebase/messaging";
import {SafeAreaView as SafeAreaViewSafe} from "react-native-safe-area-context";
import RNFS from "react-native-fs";
import RNShare from "react-native-share";
import {
  pick,
  pickDirectory,
  keepLocalCopy,
  types,
} from "@react-native-documents/picker";
import {launchImageLibrary} from "react-native-image-picker";
import QRCode from "react-native-qrcode-svg";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from "react-native-vision-camera";
import {
  getLiveKitCredentials,
  LiveKitCredentials,
} from "../../../services/livekitApi";
import {SERVER_URL, getApiAuthHeaders, getApiJsonHeaders} from "../../../services/api";
import CallControlIcon from "../components/CallControlIcon";
import {prepareSpeech} from "../../language-engine";


const getSafeFcmToken = async (): Promise<string> => {
  if (Platform.OS !== "android") return "";

  try {
    // google-services.json / Firebase native init henüz yoksa
    // messaging() senkron olarak hata atabilir. Profil kaydını bunun yüzünden
    // asla engellememeliyiz; FCM token daha sonra güncellenebilir.
    const firebaseMessaging = messaging();
    const token = await firebaseMessaging.getToken();
    return String(token || "").trim();
  } catch (error) {
    console.warn("AyTalk FCM token alınamadı; profil FCM olmadan kaydedilecek:", error);
    return "";
  }
};


type RemoteCallScreenProps = {
  visible: boolean;
  defaultName: string;
  defaultRoomCode?: string;
  onClose: () => void;
};

type LiveBridgeCallMode = "audio" | "video" | "chat";
type ProfanityMode = "direct" | "soften" | "hide";
type LiveBridgeDirectoryUser = {
  phone: string;
  name: string;
  language?: string;
  online: boolean;
  lastSeen?: number;
};
type LiveBridgeIncomingCall = {
  id: string;
  roomName: string;
  callerPhone: string;
  callerName: string;
  callerGender?: "male" | "female";
  calleePhone: string;
  mode: LiveBridgeCallMode;
  status: "ringing" | "accepted" | "rejected" | "expired";
  createdAt: number;
};
type LiveBridgeOutgoingCall = {
  id: string;
  roomName: string;
  calleePhone: string;
  calleeName: string;
  calleeGender?: "male" | "female";
  mode: LiveBridgeCallMode;
  status: "ringing" | "accepted" | "rejected" | "expired";
};
const LIVEBRIDGE_PROFILE_KEY = "livebridge_demo_profile_v1";
const DEMO_VIP_VIDEO_UNLOCKED = true;

type CallLanguage = {
  name: string;
  nativeName: string;
  locale: string;
  flag: string;
};

type TranslationPacket = {
  type: "aytalk-translation";
  original: string;
  translated: string;
  fromLanguage: string;
  toLanguage: string;
  toLocale: string;
  senderName: string;
  createdAt: number;
};

type TranslationEntry = {
  id: string;
  side: "local" | "remote";
  original: string;
  translated: string;
  senderName: string;
  createdAt: number;
};

type LiveBridgeAttachment = {
  id: string;
  side: "local" | "remote";
  name: string;
  mimeType: string;
  localPath: string;
  size: number;
  createdAt: number;
};

type AyPdfModule = {
  createConversationPdf(title: string, lines: string[]): Promise<string>;
};

type AyFileModule = {
  zipDirectory(treeUri: string, outputName: string): Promise<string>;
};

const AyPdf = NativeModules.AyPdf as AyPdfModule | undefined;
const AyFile = NativeModules.AyFile as AyFileModule | undefined;
const FILE_STREAM_TOPIC = "aytalk-file-v1";

type AySpeechModule = {
  capture(maxDurationMs: number): Promise<{
    audioBase64: string;
    durationMs: number;
  }>;
  cancel(): void;
};

const CALL_LANGUAGES: CallLanguage[] = [
  {name: "Afrikaans", nativeName: "Afrikaans", locale: "af-ZA", flag: "🇿🇦"},
  {name: "Albanian", nativeName: "Shqip", locale: "sq-AL", flag: "🇦🇱"},
  {name: "Amharic", nativeName: "አማርኛ", locale: "am-ET", flag: "🇪🇹"},
  {name: "Arabic", nativeName: "العربية", locale: "ar-SA", flag: "🇸🇦"},
  {name: "Armenian", nativeName: "Հայերեն", locale: "hy-AM", flag: "🇦🇲"},
  {name: "Azerbaijani", nativeName: "Azərbaycanca", locale: "az-AZ", flag: "🇦🇿"},
  {name: "Bengali", nativeName: "বাংলা", locale: "bn-BD", flag: "🇧🇩"},
  {name: "Bosnian", nativeName: "Bosanski", locale: "bs-BA", flag: "🇧🇦"},
  {name: "Bulgarian", nativeName: "Български", locale: "bg-BG", flag: "🇧🇬"},
  {name: "Burmese", nativeName: "မြန်မာ", locale: "my-MM", flag: "🇲🇲"},
  {name: "Catalan", nativeName: "Català", locale: "ca-ES", flag: "🇪🇸"},
  {name: "Chinese (Simplified)", nativeName: "简体中文", locale: "zh-CN", flag: "🇨🇳"},
  {name: "Croatian", nativeName: "Hrvatski", locale: "hr-HR", flag: "🇭🇷"},
  {name: "Czech", nativeName: "Čeština", locale: "cs-CZ", flag: "🇨🇿"},
  {name: "Danish", nativeName: "Dansk", locale: "da-DK", flag: "🇩🇰"},
  {name: "Dutch", nativeName: "Nederlands", locale: "nl-NL", flag: "🇳🇱"},
  {name: "English", nativeName: "English", locale: "en-US", flag: "🇬🇧"},
  {name: "Estonian", nativeName: "Eesti", locale: "et-EE", flag: "🇪🇪"},
  {name: "Filipino", nativeName: "Filipino", locale: "fil-PH", flag: "🇵🇭"},
  {name: "Finnish", nativeName: "Suomi", locale: "fi-FI", flag: "🇫🇮"},
  {name: "French", nativeName: "Français", locale: "fr-FR", flag: "🇫🇷"},
  {name: "Georgian", nativeName: "ქართული", locale: "ka-GE", flag: "🇬🇪"},
  {name: "German", nativeName: "Deutsch", locale: "de-DE", flag: "🇩🇪"},
  {name: "Greek", nativeName: "Ελληνικά", locale: "el-GR", flag: "🇬🇷"},
  {name: "Hebrew", nativeName: "עברית", locale: "he-IL", flag: "🇮🇱"},
  {name: "Hindi", nativeName: "हिन्दी", locale: "hi-IN", flag: "🇮🇳"},
  {name: "Hungarian", nativeName: "Magyar", locale: "hu-HU", flag: "🇭🇺"},
  {name: "Icelandic", nativeName: "Íslenska", locale: "is-IS", flag: "🇮🇸"},
  {name: "Indonesian", nativeName: "Bahasa Indonesia", locale: "id-ID", flag: "🇮🇩"},
  {name: "Irish", nativeName: "Gaeilge", locale: "ga-IE", flag: "🇮🇪"},
  {name: "Italian", nativeName: "Italiano", locale: "it-IT", flag: "🇮🇹"},
  {name: "Japanese", nativeName: "日本語", locale: "ja-JP", flag: "🇯🇵"},
  {name: "Kazakh", nativeName: "Қазақша", locale: "kk-KZ", flag: "🇰🇿"},
  {name: "Khmer", nativeName: "ខ្មែរ", locale: "km-KH", flag: "🇰🇭"},
  {name: "Korean", nativeName: "한국어", locale: "ko-KR", flag: "🇰🇷"},
  {name: "Lao", nativeName: "ລາວ", locale: "lo-LA", flag: "🇱🇦"},
  {name: "Latvian", nativeName: "Latviešu", locale: "lv-LV", flag: "🇱🇻"},
  {name: "Lithuanian", nativeName: "Lietuvių", locale: "lt-LT", flag: "🇱🇹"},
  {name: "Macedonian", nativeName: "Македонски", locale: "mk-MK", flag: "🇲🇰"},
  {name: "Malay", nativeName: "Bahasa Melayu", locale: "ms-MY", flag: "🇲🇾"},
  {name: "Mongolian", nativeName: "Монгол", locale: "mn-MN", flag: "🇲🇳"},
  {name: "Norwegian", nativeName: "Norsk", locale: "nb-NO", flag: "🇳🇴"},
  {name: "Persian", nativeName: "فارسی", locale: "fa-IR", flag: "🇮🇷"},
  {name: "Polish", nativeName: "Polski", locale: "pl-PL", flag: "🇵🇱"},
  {name: "Portuguese", nativeName: "Português", locale: "pt-PT", flag: "🇵🇹"},
  {name: "Romanian", nativeName: "Română", locale: "ro-RO", flag: "🇷🇴"},
  {name: "Russian", nativeName: "Русский", locale: "ru-RU", flag: "🇷🇺"},
  {name: "Serbian", nativeName: "Српски", locale: "sr-RS", flag: "🇷🇸"},
  {name: "Slovak", nativeName: "Slovenčina", locale: "sk-SK", flag: "🇸🇰"},
  {name: "Slovenian", nativeName: "Slovenščina", locale: "sl-SI", flag: "🇸🇮"},
  {name: "Spanish", nativeName: "Español", locale: "es-ES", flag: "🇪🇸"},
  {name: "Swahili", nativeName: "Kiswahili", locale: "sw-TZ", flag: "🇹🇿"},
  {name: "Swedish", nativeName: "Svenska", locale: "sv-SE", flag: "🇸🇪"},
  {name: "Tamil", nativeName: "தமிழ்", locale: "ta-IN", flag: "🇮🇳"},
  {name: "Telugu", nativeName: "తెలుగు", locale: "te-IN", flag: "🇮🇳"},
  {name: "Thai", nativeName: "ไทย", locale: "th-TH", flag: "🇹🇭"},
  {name: "Turkish", nativeName: "Türkçe", locale: "tr-TR", flag: "🇹🇷"},
  {name: "Ukrainian", nativeName: "Українська", locale: "uk-UA", flag: "🇺🇦"},
  {name: "Urdu", nativeName: "اردو", locale: "ur-PK", flag: "🇵🇰"},
  {name: "Uzbek", nativeName: "O‘zbekcha", locale: "uz-UZ", flag: "🇺🇿"},
  {name: "Vietnamese", nativeName: "Tiếng Việt", locale: "vi-VN", flag: "🇻🇳"},
];

const AySpeech =
  NativeModules.AySpeech as AySpeechModule | undefined;

type AyAudioRouteModule = {
  setSpeakerEnabled(enabled: boolean): Promise<boolean>;
};

const AyAudioRoute =
  NativeModules.AyAudioRoute as AyAudioRouteModule | undefined;

function normalizeLiveBridgePhone(value: string): string {
  return String(value || "").replace(/[^0-9]/g, "").slice(0, 18);
}

function liveBridgePhoneKeys(value: string): string[] {
  const digits = normalizeLiveBridgePhone(value);
  if (!digits) return [];

  const keys = new Set<string>();
  keys.add(digits);

  const noInternationalPrefix = digits.startsWith("00")
    ? digits.slice(2)
    : digits;
  keys.add(noInternationalPrefix);

  const noLeadingZero = digits.replace(/^0+/, "");
  if (noLeadingZero) keys.add(noLeadingZero);

  // Rehberde ülke kodu farklı yazılsa bile aynı numarayı bulmak için
  // son basamakları da demo discovery anahtarı olarak kullan.
  for (const size of [10, 9, 8]) {
    if (digits.length >= size) {
      keys.add(digits.slice(-size));
    }
    if (noInternationalPrefix.length >= size) {
      keys.add(noInternationalPrefix.slice(-size));
    }
  }

  return Array.from(keys).filter(key => key.length >= 8);
}

type BridgeCountry = {name: string; lat: number; lon: number};
const BRIDGE_CALLING_CODES: Array<{prefix: string; country: BridgeCountry}> = [
  {prefix:"855",country:{name:"Kamboçya",lat:12.5657,lon:104.991}},
  {prefix:"90",country:{name:"Türkiye",lat:38.9637,lon:35.2433}},
  {prefix:"84",country:{name:"Vietnam",lat:14.0583,lon:108.2772}},
  {prefix:"56",country:{name:"Şili",lat:-35.6751,lon:-71.543}},
  {prefix:"39",country:{name:"İtalya",lat:41.8719,lon:12.5674}},
  {prefix:"237",country:{name:"Kamerun",lat:7.3697,lon:12.3547}},
  {prefix:"998",country:{name:"Özbekistan",lat:41.3775,lon:64.5853}},
  {prefix:"994",country:{name:"Azerbaycan",lat:40.1431,lon:47.5769}},
  {prefix:"49",country:{name:"Almanya",lat:51.1657,lon:10.4515}},
  {prefix:"33",country:{name:"Fransa",lat:46.2276,lon:2.2137}},
  {prefix:"44",country:{name:"Birleşik Krallık",lat:55.3781,lon:-3.436}},
  {prefix:"1",country:{name:"ABD/Kanada",lat:39.5,lon:-98.35}},
  {prefix:"81",country:{name:"Japonya",lat:36.2048,lon:138.2529}},
  {prefix:"82",country:{name:"Güney Kore",lat:35.9078,lon:127.7669}},
  {prefix:"86",country:{name:"Çin",lat:35.8617,lon:104.1954}},
  {prefix:"91",country:{name:"Hindistan",lat:20.5937,lon:78.9629}},
  {prefix:"61",country:{name:"Avustralya",lat:-25.2744,lon:133.7751}},
  {prefix:"55",country:{name:"Brezilya",lat:-14.235,lon:-51.9253}},
];
function bridgeCountryFromPhone(phone: string): BridgeCountry | null {
  const digits = normalizeLiveBridgePhone(phone);
  return [...BRIDGE_CALLING_CODES].sort((a,b)=>b.prefix.length-a.prefix.length)
    .find(item => digits.startsWith(item.prefix))?.country || null;
}
function bridgeDistanceKm(aPhone: string, bPhone: string) {
  const a = bridgeCountryFromPhone(aPhone);
  const b = bridgeCountryFromPhone(bPhone);
  if (!a || !b) return null;
  const r = (v:number)=>(v*Math.PI)/180;
  const dLat=r(b.lat-a.lat), dLon=r(b.lon-a.lon), la1=r(a.lat), la2=r(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return {km:Math.round(6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))), firstCountry:a.name, secondCountry:b.name};
}

function formatPresence(lastSeen?: number): string {
  if (!lastSeen) return "Çevrimdışı";
  const seconds = Math.max(0, Math.floor((Date.now() - lastSeen) / 1000));
  if (seconds < 45) return "Çevrimiçi";
  if (seconds < 120) return "Az önce";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk önce`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa önce`;
  return "Çevrimdışı";
}
function normalizeRoomCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 24);
}

function createQrInvite(roomCode: string): string {
  return `aytalk://call?room=${encodeURIComponent(roomCode)}&v=1`;
}

function parseQrInvite(value: string): string | null {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    return null;
  }

  const directCode = normalizeRoomCode(cleanValue);
  if (/^AY-[A-Z0-9]{4,20}$/.test(directCode)) {
    return directCode;
  }

  const match = cleanValue.match(/[?&]room=([^&]+)/i);
  if (!match?.[1]) {
    return null;
  }

  try {
    const room = normalizeRoomCode(decodeURIComponent(match[1]));
    return /^AY-[A-Z0-9]{4,20}$/.test(room) ? room : null;
  } catch {
    return null;
  }
}

function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function RoomView({
  onLeave,
  sourceLanguage,
  targetLanguage,
  participantName,
  callMode,
  bridgeDistance,
  onChangeSourceLanguage,
  onChangeTargetLanguage,
}: {
  onLeave: () => void;
  sourceLanguage: CallLanguage;
  targetLanguage: CallLanguage;
  participantName: string;
  callMode: LiveBridgeCallMode;
  bridgeDistance?: {
    km: number;
    firstCountry: string;
    secondCountry: string;
  } | null;
  onChangeSourceLanguage: (language: CallLanguage) => void;
  onChangeTargetLanguage: (language: CallLanguage) => void;
}) {
  useKeepAwake();

  const tracks = useTracks([
    {source: Track.Source.Camera, withPlaceholder: true},
  ]);
  const {localParticipant} = useLocalParticipant();
  const room = useRoomContext();
  const {height, width} = useWindowDimensions();

  const translationRequestRef = useRef(false);
  const microphoneWasEnabledRef = useRef(true);

  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [frontCamera, setFrontCamera] = useState(true);
  const [callSeconds, setCallSeconds] = useState(0);
  const [controlBusy, setControlBusy] = useState(false);
  const [translationListening, setTranslationListening] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [localOriginal, setLocalOriginal] = useState("");
  const [localTranslated, setLocalTranslated] = useState("");
  const [remoteOriginal, setRemoteOriginal] = useState("");
  const [remoteTranslated, setRemoteTranslated] = useState("");
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [subtitlesVisible, setSubtitlesVisible] = useState(true);
  const [translationHistory, setTranslationHistory] = useState<TranslationEntry[]>([]);
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [voiceTranslationEnabled, setVoiceTranslationEnabled] = useState(true);
  const [profanityMode, setProfanityMode] =
    useState<ProfanityMode>("soften");
  const [inCallLanguagePicker, setInCallLanguagePicker] = useState<
    "source" | "target" | null
  >(null);
  const [inCallLanguageSearch, setInCallLanguageSearch] = useState("");
  const [bridgeActivated, setBridgeActivated] = useState(false);
  const [videoConversationEnabled, setVideoConversationEnabled] = useState(callMode === "video");
  const [chatInput, setChatInput] = useState("");
  const [attachments, setAttachments] = useState<LiveBridgeAttachment[]>([]);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState(0);
  const [localPreviewPosition, setLocalPreviewPosition] = useState({x: 0, y: 0});
  const localPreviewDragStart = useRef({x: 0, y: 0});
  const subtitleScrollRef = useRef<ScrollView | null>(null);

  const remoteTrack = tracks.find(track => !track.participant.isLocal);
  const localCameraPublication = localParticipant.getTrackPublication(
    Track.Source.Camera,
  );

  const filteredInCallLanguages = useMemo(() => {
    const query = inCallLanguageSearch
      .trim()
      .toLocaleLowerCase("tr-TR");

    if (!query) {
      return CALL_LANGUAGES;
    }

    return CALL_LANGUAGES.filter(language =>
      `${language.name} ${language.nativeName} ${language.locale}`
        .toLocaleLowerCase("tr-TR")
        .includes(query),
    );
  }, [inCallLanguageSearch]);

  const localPreviewWidth = Math.max(104, Math.min(132, width * 0.29));
  const localPreviewHeight = Math.round(localPreviewWidth * 1.36);
  const translationPanelHeight = Math.max(250, Math.min(360, height * 0.36));
  const videoSafeTop = 94;
  const previewDefaultX = Math.max(10, width - localPreviewWidth - 14);
  const previewDefaultY = Math.max(
    videoSafeTop + 20,
    height - translationPanelHeight - localPreviewHeight - 18,
  );

  useEffect(() => {
    setLocalPreviewPosition(current => {
      if (current.x === 0 && current.y === 0) {
        return {x: previewDefaultX, y: previewDefaultY};
      }

      return {
        x: Math.min(
          Math.max(10, current.x),
          Math.max(10, width - localPreviewWidth - 10),
        ),
        y: Math.min(
          Math.max(videoSafeTop, current.y),
          Math.max(
            videoSafeTop,
            height - translationPanelHeight - localPreviewHeight - 10,
          ),
        ),
      };
    });
  }, [
    height,
    width,
    localPreviewHeight,
    localPreviewWidth,
    previewDefaultX,
    previewDefaultY,
    translationPanelHeight,
  ]);

  const localPreviewPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => {
          localPreviewDragStart.current = localPreviewPosition;
        },
        onPanResponderMove: (_event, gesture) => {
          const maxX = Math.max(10, width - localPreviewWidth - 10);
          const maxY = Math.max(
            videoSafeTop,
            height - translationPanelHeight - localPreviewHeight - 10,
          );

          const nextX = Math.min(
            maxX,
            Math.max(10, localPreviewDragStart.current.x + gesture.dx),
          );
          const nextY = Math.min(
            maxY,
            Math.max(
              videoSafeTop,
              localPreviewDragStart.current.y + gesture.dy,
            ),
          );

          setLocalPreviewPosition({x: nextX, y: nextY});
        },
      }),
    [
      height,
      width,
      localPreviewHeight,
      localPreviewPosition,
      localPreviewWidth,
      translationPanelHeight,
    ],
  );

  const addTranslationEntry = (entry: TranslationEntry) => {
    setTranslationHistory(previous => [...previous.slice(-39), entry]);
  };

  useEffect(() => {
    return () => {
      try {
        AySpeech?.cancel();
      } catch {}
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    void AsyncStorage.getItem("aytalk_profanity_mode")
      .then(value => {
        if (
          mounted &&
          (value === "direct" ||
            value === "soften" ||
            value === "hide")
        ) {
          setProfanityMode(value);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const changeProfanityMode = (mode: ProfanityMode) => {
    setProfanityMode(mode);
    void AsyncStorage.setItem(
      "aytalk_profanity_mode",
      mode,
    ).catch(() => undefined);
  };

  useEffect(() => {
    setVideoConversationEnabled(callMode === "video");
    if (callMode === "chat") {
      setMicrophoneEnabled(false);
      setCameraEnabled(false);
    }
  }, [callMode]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCallSeconds(current => current + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      subtitleScrollRef.current?.scrollToEnd({animated: true});
    }, 80);

    return () => clearTimeout(timer);
  }, [translationHistory, translationListening, translationBusy]);

  useEffect(() => {
    void Tts.setDefaultRate(0.46);
    void Tts.setDefaultPitch(1.0);
    void Tts.setDucking(false);

    return () => {
      void Tts.stop();
    };
  }, []);

  const playCloudTranslation = async (
    text: string,
    languageName: string,
    gender: "male" | "female",
  ) => {
    const response = await fetch(`${SERVER_URL}/tts`, {
      method: "POST",
      headers: getApiJsonHeaders(),
      body: JSON.stringify({text, language: languageName, gender}),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Bulut seslendirme başarısız.");
    }

    const audioBase64 = String(data?.audioBase64 || "");
    if (!audioBase64) throw new Error("Bulut sesi boş döndü.");

    const filePath =
      `${RNFS.CachesDirectoryPath}/livebridge-tts-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}.mp3`;

    await RNFS.writeFile(filePath, audioBase64, "base64");

    try {
      Sound.setCategory?.("Playback");
      if (AyAudioRoute) {
        await AyAudioRoute.setSpeakerEnabled(true);
      }

      await new Promise<void>((resolve, reject) => {
        const sound = new Sound(filePath, "", error => {
          if (error) {
            reject(error);
            return;
          }

          sound.setVolume(1);
          sound.setNumberOfLoops(0);
          sound.play(ok => {
            try {
              sound.release();
            } catch {}
            ok ? resolve() : reject(new Error("Ses oynatılamadı."));
          });
        });
      });
    } finally {
      void RNFS.unlink(filePath).catch(() => undefined);
    }
  };

  const speakTranslation = async (translated: string, locale: string) => {
    if (!voiceTranslationEnabled || !translated.trim()) return;

    const languageName =
      CALL_LANGUAGES.find(item => item.locale === locale)?.name || locale;
    const remoteGender: "male" | "female" =
      outgoingCall?.calleeGender || incomingCall?.callerGender || "female";

    const voices = await Tts.voices().catch(() => []);
    const prepared = prepareSpeech({text: translated, locale, voices});

    try {
      await Tts.stop();
      await playCloudTranslation(
        prepared.speechText,
        languageName,
        remoteGender,
      );
      return;
    } catch (cloudError) {
      console.log("LiveBridge cloud TTS fallback:", cloudError);
    }

    try {
      if (prepared.selectedVoiceId) {
        await Tts.setDefaultVoice(prepared.selectedVoiceId);
      } else {
        await Tts.setDefaultLanguage(prepared.selectedLocale);
      }
      await Tts.setDefaultRate(0.48);
      await Tts.setDefaultPitch(remoteGender === "male" ? 0.92 : 1.04);
      await Tts.speak(prepared.speechText, {
        iosVoiceId: prepared.selectedVoiceId || "",
        rate: 0.48,
        androidParams: {
          KEY_PARAM_PAN: 0,
          KEY_PARAM_VOLUME: 1.0,
          KEY_PARAM_STREAM: "STREAM_MUSIC",
        },
      });
    } catch (deviceTtsError) {
      Alert.alert(
        "Seslendirme",
        deviceTtsError instanceof Error
          ? deviceTtsError.message
          : "Çeviri sesi oynatılamadı.",
      );
    }
  };

  useEffect(() => {
    let cancelled = false;

    const startLocalMedia = async () => {
      try {
        await localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        });
        if (callMode === "video") {
          await localParticipant.setCameraEnabled(true);
        }

        if (AyAudioRoute) {
          await AyAudioRoute.setSpeakerEnabled(true);
        }

        if (!cancelled) {
          setMicrophoneEnabled(true);
          setSpeakerEnabled(true);
          setCameraEnabled(callMode === "video");
          setVideoConversationEnabled(callMode === "video");
        }
      } catch (mediaError) {
        if (!cancelled) {
          Alert.alert(
            "Kamera/Mikrofon başlatılamadı",
            mediaError instanceof Error
              ? mediaError.message
              : "Yerel kamera ve mikrofon açılamadı.",
          );
        }
      }
    };

    const startupTimer = setTimeout(() => {
      void startLocalMedia();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(startupTimer);
    };
  }, [callMode, localParticipant]);

  useEffect(() => {
    const handleDataReceived = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic && topic !== "aytalk.translation") {
        return;
      }

      try {
        const decoded = Buffer.from(payload).toString("utf8");
        const packet = JSON.parse(decoded) as TranslationPacket;

        if (packet.type !== "aytalk-translation") {
          return;
        }

        setRemoteOriginal(packet.original);
        setRemoteTranslated(packet.translated);
        setBridgeActivated(true);
        addTranslationEntry({
          id: `${packet.createdAt}-remote`,
          side: "remote",
          original: packet.original,
          translated: packet.translated,
          senderName: packet.senderName || "Karşı taraf",
          createdAt: packet.createdAt,
        });
        void speakTranslation(
          packet.translated,
          packet.toLocale || targetLanguage.locale,
        );
      } catch {
        // AyTalk dışındaki veri paketlerini sessizce yok say.
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, voiceTranslationEnabled, targetLanguage.locale]);

  useEffect(() => {
    const handleRemoteAudioTrack = () => {
      if (AyAudioRoute && speakerEnabled) {
        void AyAudioRoute.setSpeakerEnabled(true).catch(() => undefined);
      }
    };

    room.on(RoomEvent.TrackSubscribed, handleRemoteAudioTrack);
    room.on(RoomEvent.ParticipantConnected, handleRemoteAudioTrack);

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleRemoteAudioTrack);
      room.off(RoomEvent.ParticipantConnected, handleRemoteAudioTrack);
    };
  }, [room, speakerEnabled]);

  const restoreCallMicrophone = async () => {
    try {
      if (microphoneWasEnabledRef.current) {
        await new Promise<void>(resolve => {
          setTimeout(() => resolve(), 260);
        });

        await localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        });
        setMicrophoneEnabled(true);
      }
    } catch {
      // Görüşme mikrofonu bir sonraki dokunuşta tekrar açılabilir.
    }
  };

  const publishTranslation = async (
    original: string,
    translated: string,
  ) => {
    const packet: TranslationPacket = {
      type: "aytalk-translation",
      original,
      translated,
      fromLanguage: sourceLanguage.name,
      toLanguage: targetLanguage.name,
      toLocale: targetLanguage.locale,
      senderName: participantName,
      createdAt: Date.now(),
    };

    const payload = Buffer.from(JSON.stringify(packet), "utf8");

    await room.localParticipant.publishData(payload, {
      reliable: true,
      topic: "aytalk.translation",
    });
  };

  const translateRecognizedText = async (recognizedText: string) => {
    const cleanText = recognizedText.trim();
    if (!cleanText || translationRequestRef.current) {
      return;
    }

    translationRequestRef.current = true;
    setTranslationBusy(true);
    setLocalOriginal(cleanText);
    setLocalTranslated("");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${SERVER_URL}/call/translate`, {
        method: "POST",
        headers: getApiJsonHeaders(),
        body: JSON.stringify({
          message: cleanText,
          from: sourceLanguage.name,
          to: targetLanguage.name,
          profanityMode,
          context: translationHistory
            .slice(-8)
            .map(entry => ({
              role: entry.side === "local" ? "speaker" : "other",
              source: entry.original,
              translation: entry.translated,
            })),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Çeviri sunucusu hata verdi.");
      }

      const translated = String(data?.reply || "").trim();
      if (!translated) {
        throw new Error("Çeviri yanıtı boş geldi.");
      }

      setLocalTranslated(translated);
      setBridgeActivated(true);
      addTranslationEntry({
        id: `${Date.now()}-local`,
        side: "local",
        original: cleanText,
        translated,
        senderName: participantName,
        createdAt: Date.now(),
      });
      await publishTranslation(cleanText, translated);
    } catch (translationError) {
      Alert.alert(
        "Canlı çeviri hatası",
        translationError instanceof Error
          ? translationError.message
          : "Konuşma çevrilemedi.",
      );
    } finally {
      translationRequestRef.current = false;
      setTranslationBusy(false);
      setTranslationListening(false);
    }
  };



  const startPushToTranslate = async () => {
    if (translationListening || translationBusy) {
      try {
        AySpeech?.cancel();
      } catch {}

      setTranslationListening(false);
      await restoreCallMicrophone();
      return;
    }

    if (!AySpeech) {
      Alert.alert(
        "Ses kayıt modülü bulunamadı",
        "AyTalk yerel ses kayıt modülü yüklenmemiş.",
      );
      return;
    }

    try {
      setLocalOriginal("");
      setLocalTranslated("");

      microphoneWasEnabledRef.current =
        localParticipant.isMicrophoneEnabled;

      // WebRTC odası açık kalır; yalnızca yerel mikrofon capture
      // kısa süreli serbest bırakılır. Google SpeechRecognizer yoktur.
      const microphonePublication =
        localParticipant.getTrackPublication(
          Track.Source.Microphone,
        );
      const microphoneTrack = microphonePublication?.track;

      if (microphoneTrack && microphoneWasEnabledRef.current) {
        // Çeviri kaydı sırasında LiveKit odasını kapatma.
        // Track'i odadan geçici çıkar ama nesneyi destroy etme;
        // çeviri bittiğinde mikrofon güvenli biçimde yeniden yayınlanabilir.
        await localParticipant.unpublishTrack(
          microphoneTrack,
          true,
        );
        setMicrophoneEnabled(false);
      }

      await new Promise<void>(resolve => {
        setTimeout(() => resolve(), 350);
      });

      setTranslationListening(true);

      const captured = await AySpeech.capture(12000);
      setTranslationListening(false);

      const audioBase64 = String(
        captured?.audioBase64 || "",
      ).trim();

      if (!audioBase64) {
        throw new Error("Ses kaydı boş geldi.");
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        30000,
      );

      const response = await fetch(
        `${SERVER_URL}/audio/transcribe`,
        {
          method: "POST",
          headers: getApiJsonHeaders(),
          body: JSON.stringify({
            audioBase64,
            language: sourceLanguage.locale
              .split("-")[0]
              .toLowerCase(),
          }),
          signal: controller.signal,
        },
      );

      clearTimeout(timeout);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data?.error || "Ses yazıya çevrilemedi.",
        );
      }

      const recognized = String(
        data?.text || "",
      ).trim();

      if (!recognized) {
        throw new Error("Konuşma algılanmadı.");
      }

      setLocalOriginal(recognized);
      await translateRecognizedText(recognized);
    } catch (speechError) {
      setTranslationListening(false);

      const message =
        speechError instanceof Error
          ? speechError.message
          : "Ses algılanamadı.";

      if (
        !message.toLowerCase().includes("iptal") &&
        !message.toLowerCase().includes("cancel")
      ) {
        Alert.alert(
          "Konuşma algılama hatası",
          message,
        );
      }
    } finally {
      await restoreCallMicrophone();
    }
  };

  const toggleMicrophone = async () => {
    if (controlBusy) return;

    try {
      setControlBusy(true);
      const next = !microphoneEnabled;
      await localParticipant.setMicrophoneEnabled(
        next,
        next
          ? {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 48000,
            }
          : undefined,
      );
      setMicrophoneEnabled(next);
    } catch (error) {
      Alert.alert(
        "Mikrofon hatası",
        error instanceof Error ? error.message : "Mikrofon değiştirilemedi.",
      );
    } finally {
      setControlBusy(false);
    }
  };

  const toggleCamera = async () => {
    if (controlBusy) return;

    try {
      setControlBusy(true);
      const next = !cameraEnabled;
      await localParticipant.setCameraEnabled(next);
      setCameraEnabled(next);
      if (next && callMode === "video") {
        setVideoConversationEnabled(true);
      }
    } catch (error) {
      Alert.alert(
        "Kamera hatası",
        error instanceof Error ? error.message : "Kamera değiştirilemedi.",
      );
    } finally {
      setControlBusy(false);
    }
  };

  const flipCamera = async () => {
    if (controlBusy || !cameraEnabled || !videoConversationEnabled) return;

    try {
      setControlBusy(true);
      const publication = localParticipant.getTrackPublication(Track.Source.Camera);
      const localVideoTrack = publication?.track as
        | {
            restartTrack?: (options?: {facingMode?: "user" | "environment"}) => Promise<void>;
            mediaStreamTrack?: {
              _switchCamera?: () => void;
              applyConstraints?: (constraints: object) => Promise<void>;
            };
          }
        | undefined;

      if (!localVideoTrack) throw new Error("Aktif kamera bulunamadı.");

      const nextFacingMode: "user" | "environment" =
        frontCamera ? "environment" : "user";

      if (typeof localVideoTrack.restartTrack === "function") {
        await localVideoTrack.restartTrack({facingMode: nextFacingMode});
      } else if (typeof localVideoTrack.mediaStreamTrack?._switchCamera === "function") {
        localVideoTrack.mediaStreamTrack._switchCamera();
        await new Promise<void>(resolve => setTimeout(resolve, 220));
      } else if (typeof localVideoTrack.mediaStreamTrack?.applyConstraints === "function") {
        await localVideoTrack.mediaStreamTrack.applyConstraints({facingMode: nextFacingMode});
      } else {
        throw new Error("Bu cihaz kamera değiştirmeyi desteklemiyor.");
      }

      setFrontCamera(nextFacingMode === "user");
    } catch (error) {
      Alert.alert(
        "Kamera değiştirilemedi",
        error instanceof Error ? error.message : "Bilinmeyen kamera hatası.",
      );
    } finally {
      setControlBusy(false);
    }
  };

  const toggleVideoConversation = async () => {
    if (controlBusy || callMode === "audio") return;
    try {
      setControlBusy(true);
      const next = !videoConversationEnabled;
      await localParticipant.setCameraEnabled(next);
      setCameraEnabled(next);
      setVideoConversationEnabled(next);
    } catch (error) {
      Alert.alert(
        "Görüntü modu değiştirilemedi",
        error instanceof Error ? error.message : "Görüntülü/sesli mod değiştirilemedi.",
      );
    } finally {
      setControlBusy(false);
    }
  };

  const sendTypedChat = async () => {
    const clean = chatInput.trim();
    if (!clean || translationBusy || translationListening) return;
    setChatInput("");
    await translateRecognizedText(clean);
  };

  const toggleSpeaker = async () => {
    try {
      if (!AyAudioRoute) {
        throw new Error("AyAudioRoute native modülü bulunamadı.");
      }

      const next = !speakerEnabled;
      await AyAudioRoute.setSpeakerEnabled(next);
      setSpeakerEnabled(next);
    } catch (audioError) {
      Alert.alert(
        "Hoparlör değiştirilemedi",
        audioError instanceof Error
          ? audioError.message
          : "Native ses yönlendirmesi başarısız.",
      );
    }
  };

  useEffect(() => {
    const handleIncomingFile = async (
      reader: {
        info: {
          name?: string;
          mimeType?: string;
          size?: number;
          id?: string;
        };
        readAll: () => Promise<Uint8Array[]>;
      },
    ) => {
      try {
        const chunks = await reader.readAll();
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const joined = new Uint8Array(total);
        let offset = 0;

        chunks.forEach(chunk => {
          joined.set(chunk, offset);
          offset += chunk.length;
        });

        const safeName = String(reader.info.name || `dosya-${Date.now()}`)
          .replace(/[^a-zA-Z0-9._-]/g, "_");
        const targetPath = `${RNFS.CachesDirectoryPath}/${Date.now()}-${safeName}`;

        await RNFS.writeFile(
          targetPath,
          Buffer.from(joined).toString("base64"),
          "base64",
        );

        setAttachments(current => [
          ...current,
          {
            id: String(reader.info.id || `${Date.now()}-${safeName}`),
            side: "remote",
            name: safeName,
            mimeType: String(
              reader.info.mimeType || "application/octet-stream",
            ),
            localPath: targetPath,
            size: Number(reader.info.size || total),
            createdAt: Date.now(),
          },
        ]);
      } catch (error) {
        console.log("LiveBridge dosya alma hatası:", error);
      }
    };

    try {
      room.registerByteStreamHandler(
        FILE_STREAM_TOPIC,
        handleIncomingFile,
      );
    } catch (error) {
      console.log("LiveBridge byte stream handler:", error);
    }

    return () => {
      try {
        room.unregisterByteStreamHandler(FILE_STREAM_TOPIC);
      } catch {}
    };
  }, [room]);

  const sendLocalFile = async ({
    localPath,
    name,
    mimeType,
  }: {
    localPath: string;
    name: string;
    mimeType: string;
  }) => {
    const cleanPath = localPath.replace(/^file:\/\//, "");
    const stat = await RNFS.stat(cleanPath);
    const size = Number(stat.size);

    if (size > 40 * 1024 * 1024) {
      throw new Error("Demo sürümünde dosya sınırı 40 MB.");
    }

    setAttachmentBusy(true);
    setAttachmentProgress(0);

    try {
      const base64 = await RNFS.readFile(cleanPath, "base64");
      const bytes = new Uint8Array(Buffer.from(base64, "base64"));

      await room.localParticipant.sendBytes(bytes, {
        topic: FILE_STREAM_TOPIC,
        name,
        mimeType,
        onProgress: progress =>
          setAttachmentProgress(
            Math.max(0, Math.min(1, progress || 0)),
          ),
      });

      setAttachments(current => [
        ...current,
        {
          id: `local-${Date.now()}-${name}`,
          side: "local",
          name,
          mimeType,
          localPath: cleanPath,
          size,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setAttachmentBusy(false);
      setAttachmentProgress(0);
    }
  };

  const pickConversationImage = async () => {
    setAttachmentMenuVisible(false);

    try {
      const result = await launchImageLibrary({
        mediaType: "photo",
        selectionLimit: 1,
        quality: 0.9,
      });

      if (result.didCancel) return;
      if (result.errorCode) {
        throw new Error(result.errorMessage || result.errorCode);
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      await sendLocalFile({
        localPath: asset.uri,
        name: asset.fileName || `AyTalk-${Date.now()}.jpg`,
        mimeType: asset.type || "image/jpeg",
      });
    } catch (error) {
      Alert.alert(
        "Resim gönderilemedi",
        error instanceof Error ? error.message : "Bilinmeyen hata.",
      );
    }
  };

  const pickConversationDocument = async () => {
    setAttachmentMenuVisible(false);

    try {
      const [file] = await pick({
        type: [types.allFiles],
        allowMultiSelection: false,
        mode: "import",
      });

      const [copy] = await keepLocalCopy({
        destination: "cachesDirectory",
        files: [
          {
            uri: file.uri,
            fileName: file.name || `dosya-${Date.now()}`,
          },
        ],
      });

      if (copy.status !== "success") {
        throw new Error(
          copy.copyError || "Dosya yerel depoya kopyalanamadı.",
        );
      }

      await sendLocalFile({
        localPath: copy.localUri,
        name: file.name || `dosya-${Date.now()}`,
        mimeType: file.type || "application/octet-stream",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("cancel")) {
        Alert.alert("Dosya gönderilemedi", message);
      }
    }
  };

  const pickAndSendFolder = async () => {
    setAttachmentMenuVisible(false);

    try {
      if (!AyFile) {
        throw new Error("AyFile native modülü yüklenmedi.");
      }

      const directory = await pickDirectory({
        requestLongTermAccess: false,
      });

      if (!directory?.uri) return;

      const zipName = `AyTalk-Klasor-${Date.now()}.zip`;
      const zipPath = await AyFile.zipDirectory(
        directory.uri,
        zipName,
      );

      await sendLocalFile({
        localPath: zipPath,
        name: zipName,
        mimeType: "application/zip",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("cancel")) {
        Alert.alert("Klasör gönderilemedi", message);
      }
    }
  };

  const shareAttachment = async (
    attachment: LiveBridgeAttachment,
  ) => {
    const uri = attachment.localPath.startsWith("file://")
      ? attachment.localPath
      : `file://${attachment.localPath}`;

    await RNShare.open({
      url: uri,
      type: attachment.mimeType,
      title: attachment.name,
      useInternalStorage: true,
      failOnCancel: false,
    });
  };

  const exportConversationPdf = async () => {
    if (!AyPdf) {
      Alert.alert("PDF modülü", "AyPdf native modülü yüklenmedi.");
      return;
    }

    const items = [
      ...translationHistory.map(entry => ({
        time: entry.createdAt,
        line:
          `${entry.side === "local" ? "Sen" : entry.senderName}\n` +
          `${entry.original}\n→ ${entry.translated}`,
      })),
      ...attachments.map(item => ({
        time: item.createdAt,
        line:
          `${item.side === "local" ? "Sen" : "Karşı taraf"} · Dosya: ${item.name}`,
      })),
    ].sort((a, b) => a.time - b.time);

    if (items.length === 0) {
      Alert.alert(
        "Konuşma geçmişi",
        "PDF oluşturmak için henüz kayıt yok.",
      );
      return;
    }

    try {
      const path = await AyPdf.createConversationPdf(
        "LiveBridge Görüşme Geçmişi",
        items.map(item => item.line),
      );

      await RNShare.open({
        url: path.startsWith("file://") ? path : `file://${path}`,
        type: "application/pdf",
        title: "LiveBridge Görüşme Geçmişi",
        useInternalStorage: true,
        failOnCancel: false,
      });
    } catch (error) {
      Alert.alert(
        "PDF oluşturulamadı",
        error instanceof Error ? error.message : "Bilinmeyen hata.",
      );
    }
  };

  const renderRemoteVideo = () => {
    if (callMode === "audio" || !videoConversationEnabled) {
      return (
        <View style={styles.audioConversationStage}>
          <View style={styles.audioConversationHeader}>
            <View style={styles.audioConversationAvatar}>
              <CallControlIcon name="message" size={36} />
            </View>
            <View style={styles.audioConversationHeaderText}>
              <Text style={styles.audioConversationTitle}>LiveBridge Sesli</Text>
              <Text style={styles.audioConversationSubtitle}>
                Sesli görüşme · Çeviri · Kayıtlı sohbet
              </Text>
            </View>
          </View>

          <ScrollView
            ref={subtitleScrollRef}
            style={styles.audioConversationScroll}
            contentContainerStyle={styles.audioConversationContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              subtitleScrollRef.current?.scrollToEnd({animated: true})
            }>
            {translationHistory.length === 0 ? (
              <View style={styles.audioConversationEmpty}>
                <Text style={styles.audioConversationEmptyTitle}>Konuşmaya başlayın</Text>
                <Text style={styles.audioConversationEmptyText}>
                  Çeviri düğmesiyle konuşabilir veya aşağıdan mesaj yazabilirsiniz.
                  Görüşmedeki çeviriler bu alanda kayıtlı kalır.
                </Text>
              </View>
            ) : (
              translationHistory.map(entry => (
                <View
                  key={entry.id}
                  style={[
                    styles.audioMessageBubble,
                    entry.side === "local"
                      ? styles.audioMessageBubbleLocal
                      : styles.audioMessageBubbleRemote,
                  ]}>
                  <Text style={styles.audioMessageSender}>
                    {entry.side === "local" ? "Sen" : entry.senderName}
                  </Text>
                  <Text style={styles.audioMessageOriginal}>{entry.original}</Text>
                  <Text style={styles.audioMessageTranslated}>{entry.translated}</Text>
                  <TouchableOpacity
                    style={styles.audioReplayButton}
                    onPress={() =>
                      void speakTranslation(
                        entry.translated,
                        entry.side === "local"
                          ? targetLanguage.locale
                          : sourceLanguage.locale,
                      )
                    }>
                    <CallControlIcon name="speaker" size={18} />
                    <Text style={styles.audioReplayText}>Dinle</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            {attachments.map(item => (
              <View
                key={item.id}
                style={[
                  styles.attachmentBubble,
                  item.side === "local"
                    ? styles.attachmentBubbleLocal
                    : styles.attachmentBubbleRemote,
                ]}>
                <CallControlIcon name="message" size={22} />
                <View style={styles.attachmentTextWrap}>
                  <Text style={styles.attachmentName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.attachmentMeta}>
                    {(item.size / 1024 / 1024).toFixed(1)} MB
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.attachmentShareButton}
                  onPress={() => void shareAttachment(item)}>
                  <Text style={styles.attachmentShareText}>Paylaş</Text>
                </TouchableOpacity>
              </View>
            ))}

            {attachmentBusy ? (
              <View style={styles.attachmentProgressWrap}>
                <Text style={styles.attachmentProgressText}>
                  Dosya gönderiliyor · %{Math.round(attachmentProgress * 100)}
                </Text>
                <View style={styles.attachmentProgressTrack}>
                  <View
                    style={[
                      styles.attachmentProgressFill,
                      {
                        width: `${Math.round(
                          attachmentProgress * 100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}

            {translationListening ? <Text style={styles.audioConversationState}>Dinliyorum…</Text> : null}
            {translationBusy ? <Text style={styles.audioConversationState}>Çevriliyor…</Text> : null}
          </ScrollView>

          <View style={styles.chatUtilityRow}>
            <TouchableOpacity
              style={styles.chatPlusButton}
              onPress={() => setAttachmentMenuVisible(true)}>
              <Text style={styles.chatPlusText}>＋</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.chatPdfButton}
              onPress={() => void exportConversationPdf()}>
              <Text style={styles.chatPdfText}>PDF</Text>
            </TouchableOpacity>

            <View style={styles.audioChatComposer}>
              <TextInput
                style={styles.audioChatInput}
                value={chatInput}
                onChangeText={setChatInput}
                placeholder="Mesaj yaz ve çevir..."
                placeholderTextColor="#607A9B"
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={[
                  styles.audioChatSendButton,
                  !chatInput.trim() &&
                    styles.audioChatSendButtonDisabled,
                ]}
                disabled={!chatInput.trim() || translationBusy}
                onPress={() => void sendTypedChat()}>
                <Text style={styles.audioChatSendText}>Gönder</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    if (remoteTrack && isTrackReference(remoteTrack)) {
      return <VideoTrack trackRef={remoteTrack} style={styles.remoteVideo} />;
    }

    return (
      <View style={styles.remotePlaceholder}>
        <View style={styles.remoteAvatar}>
          <CallControlIcon name="videoMode" size={46} />
        </View>
        <Text style={styles.remoteWaitingTitle}>Diğer katılımcı bekleniyor</Text>
        <Text style={styles.remoteWaitingText}>
          Katılımcı bağlandığında görüntüsü burada tam ekran görünecek.
        </Text>
      </View>
    );
  };

  const renderLocalPreview = () => {
    if (cameraEnabled && localCameraPublication) {
      return (
        <VideoTrack
          trackRef={{
            participant: localParticipant,
            publication: localCameraPublication,
            source: Track.Source.Camera,
          }}
          style={{
            ...styles.localVideo,
            width: localPreviewWidth,
            height: localPreviewHeight,
          }}
        />
      );
    }

    return (
      <View
        style={[
          styles.localVideo,
          styles.localPlaceholder,
          {
            width: localPreviewWidth,
            height: localPreviewHeight,
          },
        ]}>
        <CallControlIcon name="cameraOff" size={36} />
        <Text style={styles.localPlaceholderText}>Kamera kapalı</Text>
      </View>
    );
  };

  return (
    <SafeAreaViewSafe style={styles.roomContainer}>
      <RoomAudioRenderer />
      <View style={styles.callStage}>
        {renderRemoteVideo()}

        <View style={styles.callTopOverlay}>
          <Text style={styles.roomTitle}>LiveBridge</Text>
          <View style={styles.callStatusRow}>
            <View style={styles.callStatusDot} />
            <Text style={styles.roomSubtitle}>
              Bağlı · {formatCallDuration(callSeconds)}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.topMoreButton}
          onPress={() => setMoreMenuVisible(true)}>
          <CallControlIcon name="more" size={23} />
        </TouchableOpacity>

        <View style={styles.inCallLanguageBar}>
          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.inCallLanguageChip}
            onPress={() => {
              setInCallLanguageSearch("");
              setInCallLanguagePicker("source");
            }}>
            <Text style={styles.inCallLanguageChipLabel}>
              BEN
            </Text>
            <Text
              numberOfLines={1}
              style={styles.inCallLanguageChipValue}>
              {sourceLanguage.nativeName}
            </Text>
          </TouchableOpacity>

          <Text style={styles.inCallLanguageDirection}>→</Text>

          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.inCallLanguageChip}
            onPress={() => {
              setInCallLanguageSearch("");
              setInCallLanguagePicker("target");
            }}>
            <Text style={styles.inCallLanguageChipLabel}>
              ÇEVİRİ
            </Text>
            <Text
              numberOfLines={1}
              style={styles.inCallLanguageChipValue}>
              {targetLanguage.nativeName}
            </Text>
          </TouchableOpacity>
        </View>

        {videoConversationEnabled &&
        subtitlesVisible &&
        (translationHistory.length > 0 || translationListening || translationBusy || localOriginal) ? (
          <View style={styles.unifiedSubtitlePanel}>
            <View style={styles.subtitlePanelHandle} />
            <View style={styles.subtitlePanelHeader}>
              <Text style={styles.subtitleLanguageSource}>
                {sourceLanguage.nativeName}
              </Text>
              <Text style={styles.subtitleLanguageArrow}>→</Text>
              <Text style={styles.subtitleLanguageTarget}>
                {targetLanguage.nativeName}
              </Text>

              <TouchableOpacity
                style={styles.subtitleHeaderButton}
                onPress={() => setVoiceTranslationEnabled(value => !value)}>
                <CallControlIcon
                  name={voiceTranslationEnabled ? "speaker" : "speakerOff"}
                  size={18}
                />
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={subtitleScrollRef}
              style={styles.subtitleScroll}
              contentContainerStyle={styles.subtitleScrollContent}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() =>
                subtitleScrollRef.current?.scrollToEnd({animated: true})
              }>
              {translationHistory.map((entry, index) => (
                <View
                  key={entry.id}
                  style={[
                    styles.subtitleHistoryItem,
                    index === translationHistory.length - 1 &&
                      styles.subtitleHistoryItemLatest,
                  ]}>
                  <View style={styles.subtitleRowHeader}>
                    <Text
                      style={[
                        styles.subtitleLanguageTag,
                        entry.side === "local" && styles.subtitleLanguageTagLocal,
                      ]}>
                      {entry.side === "local"
                        ? sourceLanguage.locale.split("-")[0].toUpperCase()
                        : targetLanguage.locale.split("-")[0].toUpperCase()}
                    </Text>
                    <Text
                      style={[
                        styles.subtitleWave,
                        entry.side === "local" && styles.subtitleWaveLocal,
                      ]}>
                      ▮▯▮▮
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        void speakTranslation(
                          entry.translated,
                          entry.side === "local"
                            ? targetLanguage.locale
                            : sourceLanguage.locale,
                        )
                      }>
                      <View
                        style={[
                          styles.subtitleRowSpeakerButton,
                          entry.side === "local" &&
                            styles.subtitleRowSpeakerButtonLocal,
                        ]}>
                        <CallControlIcon name="speaker" size={17} />
                      </View>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.subtitleOriginal}>{entry.original}</Text>
                  <Text style={styles.subtitleTranslated}>{entry.translated}</Text>
                </View>
              ))}

              {translationListening ? (
                <Text style={styles.subtitleState}>Dinliyorum… Konuş.</Text>
              ) : null}
              {translationBusy ? (
                <Text style={styles.subtitleState}>Cümle çevriliyor…</Text>
              ) : null}
            </ScrollView>
          </View>
        ) : null}

        {videoConversationEnabled && callMode === "video" ? (
        <View
          {...localPreviewPanResponder.panHandlers}
          style={[
            styles.localPreviewWrap,
            {
              width: localPreviewWidth,
              height: localPreviewHeight,
              left: localPreviewPosition.x,
              top: localPreviewPosition.y,
            },
          ]}>
          {renderLocalPreview()}
          {cameraEnabled && videoConversationEnabled ? (
            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.localPreviewFlipButton}
              onPress={() => void flipCamera()}>
              <CallControlIcon name="flip" size={22} />
            </TouchableOpacity>
          ) : null}
          <View style={styles.localPreviewBadge}>
            <Text style={styles.localPreviewBadgeText}>Sen</Text>
          </View>
        </View>
        ) : null}

        {callMode !== "chat" ? (
        <View style={styles.leftControlRail}>
          <TouchableOpacity
            style={[styles.railControlButton, !microphoneEnabled && styles.railControlDanger]}
            onPress={() => void toggleMicrophone()}>
            <CallControlIcon
              name={microphoneEnabled ? "microphone" : "microphoneOff"}
              size={24}
              danger={!microphoneEnabled}
            />
            <Text style={styles.railControlLabel}>Mikrofon</Text>
          </TouchableOpacity>

          {callMode === "video" ? (
            <TouchableOpacity
              style={[styles.railControlButton, !cameraEnabled && styles.railControlDanger]}
              onPress={() => void toggleCamera()}>
              <CallControlIcon
                name={cameraEnabled ? "camera" : "cameraOff"}
                size={25}
                danger={!cameraEnabled}
              />
              <Text style={styles.railControlLabel}>Kamera</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[
              styles.railControlButton,
              (translationListening || translationBusy) && styles.railControlTranslateActive,
            ]}
            onPress={() => void startPushToTranslate()}>
            <CallControlIcon
              name={translationListening ? "stop" : translationBusy ? "loading" : "translate"}
              size={25}
            />
            <Text style={styles.railControlTranslateLabel}>Çeviri</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.railControlButton,
              speakerEnabled && styles.railControlSpeakerActive,
            ]}
            onPress={() => void toggleSpeaker()}>
            <CallControlIcon
              name={speakerEnabled ? "speaker" : "speakerOff"}
              size={25}
            />
            <Text style={styles.railControlLabel}>Hoparlör</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.railControlButton}
            onPress={() => setAttachmentMenuVisible(true)}>
            <CallControlIcon name="more" size={25} />
            <Text style={styles.railControlLabel}>Dosya</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.railControlButton}
            onPress={() => void exportConversationPdf()}>
            <CallControlIcon name="message" size={25} />
            <Text style={styles.railControlLabel}>PDF</Text>
          </TouchableOpacity>
        </View>
        ) : null}

        <View style={styles.callBottomBar}>
          <View style={styles.bottomStatusBlock}>
            <Text style={styles.bottomStatusLabel}>Canlı Çeviri</Text>
            <View style={styles.bottomStatusRow}>
              <View style={styles.bottomStatusDot} />
              <Text style={styles.bottomStatusText}>
                {translationListening
                  ? "Dinliyor"
                  : translationBusy
                    ? "Çeviriyor"
                    : bridgeActivated
                      ? "Dil köprüsü aktif"
                      : "Hazır"}
              </Text>
            </View>
            {bridgeDistance ? (
              <Text style={styles.bottomDistanceText}>
                {bridgeDistance.firstCountry} ↔ {bridgeDistance.secondCountry}
                {"\n"}≈ {bridgeDistance.km.toLocaleString("tr-TR")} km
              </Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.bottomFileButton}
            onPress={() => setAttachmentMenuVisible(true)}>
            <CallControlIcon name="more" size={21} />
            <Text style={styles.bottomFileText}>Dosya</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.bottomHangupButton} onPress={onLeave}>
            <CallControlIcon name="hangup" size={31} danger />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.bottomSubtitleButton}
            onPress={() => setSubtitlesVisible(value => !value)}>
            <CallControlIcon name="subtitles" size={22} />
            <Text style={styles.bottomSubtitleText}>
              {subtitlesVisible ? "Altyazı Açık" : "Altyazı Kapalı"}
            </Text>
          </TouchableOpacity>
        </View>

        <Modal
          visible={inCallLanguagePicker !== null}
          transparent
          animationType="fade"
          onRequestClose={() =>
            setInCallLanguagePicker(null)
          }>
          <View style={styles.inCallLanguageBackdrop}>
            <View style={styles.inCallLanguageModal}>
              <View style={styles.inCallLanguageModalHeader}>
                <View>
                  <Text style={styles.inCallLanguageModalTitle}>
                    {inCallLanguagePicker === "source"
                      ? "Konuştuğum dil"
                      : "Çeviri dili"}
                  </Text>
                  <Text style={styles.inCallLanguageModalSubtitle}>
                    61 dilden seçim yap
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.inCallLanguageCloseButton}
                  onPress={() =>
                    setInCallLanguagePicker(null)
                  }>
                  <Text style={styles.inCallLanguageCloseButtonText}>
                    ×
                  </Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.inCallLanguageSearch}
                value={inCallLanguageSearch}
                onChangeText={setInCallLanguageSearch}
                placeholder="Dil ara..."
                placeholderTextColor="#607A9B"
                autoCapitalize="none"
              />

              <ScrollView
                style={styles.inCallLanguageList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                {filteredInCallLanguages.map(language => {
                  const selectedLocale =
                    inCallLanguagePicker === "source"
                      ? sourceLanguage.locale
                      : targetLanguage.locale;

                  const selected =
                    selectedLocale === language.locale;

                  return (
                    <TouchableOpacity
                      key={`${inCallLanguagePicker}-${language.locale}`}
                      activeOpacity={0.86}
                      style={[
                        styles.inCallLanguageItem,
                        selected &&
                          styles.inCallLanguageItemSelected,
                      ]}
                      onPress={() => {
                        if (
                          inCallLanguagePicker === "source"
                        ) {
                          onChangeSourceLanguage(language);
                        } else {
                          onChangeTargetLanguage(language);
                        }

                        setInCallLanguagePicker(null);
                        setInCallLanguageSearch("");
                      }}>
                      <Text style={styles.inCallLanguageItemFlag}>
                        {language.flag}
                      </Text>
                      <View style={styles.inCallLanguageItemTextWrap}>
                        <Text style={styles.inCallLanguageItemName}>
                          {language.nativeName}
                        </Text>
                        <Text style={styles.inCallLanguageItemEnglish}>
                          {language.name}
                        </Text>
                      </View>
                      <Text style={styles.inCallLanguageItemLocale}>
                        {language.locale}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={attachmentMenuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setAttachmentMenuVisible(false)}>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.attachmentMenuBackdrop}
            onPress={() => setAttachmentMenuVisible(false)}>
            <View style={styles.attachmentMenuCard}>
              <Text style={styles.attachmentMenuTitle}>Paylaş</Text>

              <TouchableOpacity
                style={styles.attachmentMenuItem}
                onPress={() => void pickConversationImage()}>
                <CallControlIcon name="camera" size={25} />
                <View>
                  <Text style={styles.attachmentMenuItemTitle}>
                    Resim
                  </Text>
                  <Text style={styles.attachmentMenuItemSub}>
                    Galeriden fotoğraf gönder
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachmentMenuItem}
                onPress={() => void pickConversationDocument()}>
                <CallControlIcon name="message" size={25} />
                <View>
                  <Text style={styles.attachmentMenuItemTitle}>
                    Dosya
                  </Text>
                  <Text style={styles.attachmentMenuItemSub}>
                    PDF, Word, Excel, ZIP ve diğer dosyalar
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachmentMenuItem}
                onPress={() => void pickAndSendFolder()}>
                <CallControlIcon name="message" size={25} />
                <View>
                  <Text style={styles.attachmentMenuItemTitle}>
                    Klasör
                  </Text>
                  <Text style={styles.attachmentMenuItemSub}>
                    Klasörü ZIP haline getirip gönder
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachmentMenuItem}
                onPress={() => {
                  setAttachmentMenuVisible(false);
                  void exportConversationPdf();
                }}>
                <Text style={styles.attachmentMenuItemIcon}>PDF</Text>
                <View>
                  <Text style={styles.attachmentMenuItemTitle}>
                    Görüşme PDF'i
                  </Text>
                  <Text style={styles.attachmentMenuItemSub}>
                    Çeviri geçmişini PDF olarak oluştur
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal
          visible={moreMenuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setMoreMenuVisible(false)}>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.moreMenuBackdrop}
            onPress={() => setMoreMenuVisible(false)}>
            <View style={styles.moreMenuSheet}>
              <View style={styles.moreMenuHandle} />
              <Text style={styles.moreMenuTitle}>Görüşme seçenekleri</Text>

              <TouchableOpacity
                style={styles.moreMenuItem}
                onPress={() => {
                  setSubtitlesVisible(value => !value);
                  setMoreMenuVisible(false);
                }}>
                <View style={styles.moreMenuIconWrap}>
                  <CallControlIcon name="subtitles" size={23} />
                </View>
                <View style={styles.moreMenuTextWrap}>
                  <Text style={styles.moreMenuText}>
                    {subtitlesVisible ? "Altyazıları kapat" : "Altyazıları aç"}
                  </Text>
                  <Text style={styles.moreMenuSubtext}>
                    Canlı çeviri metnini göster veya gizle
                  </Text>
                </View>
              </TouchableOpacity>

              {callMode === "video" ? (
                <TouchableOpacity
                  style={styles.moreMenuItem}
                  onPress={() => {
                    setMoreMenuVisible(false);
                    void toggleVideoConversation();
                  }}>
                  <View style={styles.moreMenuIconWrap}>
                    <CallControlIcon
                      name={videoConversationEnabled ? "videoMode" : "camera"}
                      size={24}
                    />
                  </View>
                  <View style={styles.moreMenuTextWrap}>
                    <Text style={styles.moreMenuText}>
                      {videoConversationEnabled
                        ? "Görüntülü görüşmeyi kapat"
                        : "Görüntülü görüşmeye dön"}
                    </Text>
                    <Text style={styles.moreMenuSubtext}>
                      {videoConversationEnabled
                        ? "Sesli bağlantı ve kayıtlı çeviri sohbeti devam eder"
                        : "Kamera görüntüsünü yeniden aç"}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : null}

              <View style={styles.moreMenuLanguageInfo}>
                <Text style={styles.moreMenuLanguageLabel}>
                  Çeviri yönü
                </Text>

                <View style={styles.moreMenuLanguageActions}>
                  <TouchableOpacity
                    style={styles.moreMenuLanguageButton}
                    onPress={() => {
                      setMoreMenuVisible(false);
                      setInCallLanguageSearch("");
                      setInCallLanguagePicker("source");
                    }}>
                    <Text style={styles.moreMenuLanguageButtonText}>
                      {sourceLanguage.flag} {sourceLanguage.nativeName}
                    </Text>
                  </TouchableOpacity>

                  <Text style={styles.moreMenuLanguageArrow}>→</Text>

                  <TouchableOpacity
                    style={styles.moreMenuLanguageButton}
                    onPress={() => {
                      setMoreMenuVisible(false);
                      setInCallLanguageSearch("");
                      setInCallLanguagePicker("target");
                    }}>
                    <Text style={styles.moreMenuLanguageButtonText}>
                      {targetLanguage.flag} {targetLanguage.nativeName}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.profanitySection}>
                <Text style={styles.profanityTitle}>
                  Küfür / argo çevirisi
                </Text>
                <Text style={styles.profanityHint}>
                  Tüm 61 dil için aynı kural uygulanır.
                </Text>

                <View style={styles.profanityModeRow}>
                  {(
                    [
                      ["direct", "Doğrudan"],
                      ["soften", "Yumuşat"],
                      ["hide", "Gizle"],
                    ] as Array<[ProfanityMode, string]>
                  ).map(([mode, label]) => (
                    <TouchableOpacity
                      key={mode}
                      activeOpacity={0.86}
                      style={[
                        styles.profanityModeButton,
                        profanityMode === mode &&
                          styles.profanityModeButtonActive,
                      ]}
                      onPress={() =>
                        changeProfanityMode(mode)
                      }>
                      <Text
                        style={[
                          styles.profanityModeText,
                          profanityMode === mode &&
                            styles.profanityModeTextActive,
                        ]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </SafeAreaViewSafe>
  );
}

export default function RemoteCallScreen({
  visible,
  defaultName,
  defaultRoomCode = "",
  onClose,
}: RemoteCallScreenProps) {
  const [name, setName] = useState(defaultName || "AyTalk Kullanıcısı");
  const [voiceGender, setVoiceGender] = useState<"male" | "female">("female");
  const [roomCode, setRoomCode] = useState("");
  const [credentials, setCredentials] =
    useState<LiveKitCredentials | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "preparing" | "connecting" | "connected"
  >("idle");
  const [qrInviteVisible, setQrInviteVisible] = useState(false);
  const [qrScannerVisible, setQrScannerVisible] = useState(false);
  const [qrScanLocked, setQrScanLocked] = useState(false);
  const defaultSourceLanguageIndex = Math.max(
    0,
    CALL_LANGUAGES.findIndex(language => language.name === "Turkish"),
  );
  const defaultTargetLanguageIndex = Math.max(
    0,
    CALL_LANGUAGES.findIndex(language => language.name === "Khmer"),
  );

  const [directoryPhone, setDirectoryPhone] = useState("");
  const [directoryProfileReady, setDirectoryProfileReady] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<LiveBridgeDirectoryUser[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [incomingCall, setIncomingCall] = useState<LiveBridgeIncomingCall | null>(null);
  const [outgoingCall, setOutgoingCall] = useState<LiveBridgeOutgoingCall | null>(null);
  const [activeCallMode, setActiveCallMode] = useState<LiveBridgeCallMode>("video");
  const [contactsPermissionDenied, setContactsPermissionDenied] = useState(false);
  const [selectedDirectoryUser, setSelectedDirectoryUser] =
    useState<LiveBridgeDirectoryUser | null>(null);
  const [sourceLanguageIndex, setSourceLanguageIndex] = useState(
    defaultSourceLanguageIndex,
  );
  const [targetLanguageIndex, setTargetLanguageIndex] = useState(
    defaultTargetLanguageIndex,
  );
  const [languagePickerMode, setLanguagePickerMode] = useState<
    "source" | "target" | null
  >(null);
  const [languageSearch, setLanguageSearch] = useState("");

  const sourceCallLanguage = CALL_LANGUAGES[sourceLanguageIndex];
  const targetCallLanguage = CALL_LANGUAGES[targetLanguageIndex];

  const activeBridgeDistance = useMemo(() => {
    const peerPhone = outgoingCall?.calleePhone || incomingCall?.callerPhone || "";
    return bridgeDistanceKm(directoryPhone, peerPhone);
  }, [directoryPhone, incomingCall?.callerPhone, outgoingCall?.calleePhone]);

  const filteredCallLanguages = useMemo(() => {
    const query = languageSearch.trim().toLocaleLowerCase("tr-TR");

    if (!query) {
      return CALL_LANGUAGES;
    }

    return CALL_LANGUAGES.filter(language =>
      `${language.name} ${language.nativeName} ${language.locale}`
        .toLocaleLowerCase("tr-TR")
        .includes(query),
    );
  }, [languageSearch]);

  const openLanguagePicker = (mode: "source" | "target") => {
    setLanguageSearch("");
    setLanguagePickerMode(mode);
  };

  const chooseCallLanguage = (language: CallLanguage) => {
    const index = CALL_LANGUAGES.findIndex(
      candidate => candidate.name === language.name,
    );

    if (index < 0) {
      return;
    }

    if (languagePickerMode === "source") {
      setSourceLanguageIndex(index);
    } else if (languagePickerMode === "target") {
      setTargetLanguageIndex(index);
    }

    setLanguagePickerMode(null);
    setLanguageSearch("");
  };

  const qrCameraDevice = useCameraDevice("back");
  const {
    hasPermission: hasQrCameraPermission,
    requestPermission: requestQrCameraPermission,
  } = useCameraPermission();

  useEffect(() => {
    if (visible && defaultRoomCode) {
      setRoomCode(normalizeRoomCode(defaultRoomCode));
      setError("");
    }
  }, [visible, defaultRoomCode]);

  useEffect(() => {
    if (!visible) {
      setCredentials(null);
      setError("");
      setConnectionStatus("idle");
      setQrInviteVisible(false);
      setQrScannerVisible(false);
      setQrScanLocked(false);
    }
  }, [visible]);

  useEffect(() => {
    if (credentials) return;

    return () => {
      void AudioSession.stopAudioSession();
    };
  }, [credentials]);

  const registerDirectoryProfile = useCallback(async (phoneOverride?: string) => {
    const cleanPhone = normalizeLiveBridgePhone(phoneOverride ?? directoryPhone);
    if (cleanPhone.length < 7) {
      Alert.alert("Telefon numarası", "Ülke koduyla birlikte geçerli telefon numaranı yaz.");
      return false;
    }
    try {
      const response = await fetch(`${SERVER_URL}/livebridge/profile/register`, {
        method: "POST",
        headers: getApiJsonHeaders(),
        body: JSON.stringify({
          phone: cleanPhone,
          phoneKeys: liveBridgePhoneKeys(cleanPhone),
          name: name.trim() || "LiveBridge Kullanıcısı",
          language: sourceCallLanguage.name,
          gender: voiceGender,
          fcmToken: await getSafeFcmToken(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "LiveBridge kaydı yapılamadı.");
      setDirectoryPhone(cleanPhone);
      setDirectoryProfileReady(true);
      await AsyncStorage.setItem(LIVEBRIDGE_PROFILE_KEY, JSON.stringify({phone: cleanPhone, gender: voiceGender}));
      return true;
    } catch (error) {
      Alert.alert("LiveBridge kayıt hatası", error instanceof Error ? error.message : "Profil kaydedilemedi. İnternet bağlantısını kontrol edip tekrar dene.");
      return false;
    }
  }, [directoryPhone, name, sourceCallLanguage.name, voiceGender]);

  const syncLiveBridgeContacts = useCallback(async () => {
    if (!directoryProfileReady || !directoryPhone) return;
    try {
      setDirectoryLoading(true);
      setContactsPermissionDenied(false);
      if (Platform.OS === "android") {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
          {
            title: "LiveBridge Kişiler",
            message: "Rehberindeki hangi kişilerin LiveBridge kullandığını göstermek için kişi izni gerekiyor.",
            buttonPositive: "İzin Ver",
            buttonNegative: "Şimdi Değil",
          },
        );
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          setContactsPermissionDenied(true);
          return;
        }
      }
      const contacts = await Contacts.getAll();
      const raw = contacts.flatMap(contact =>
        (contact.phoneNumbers || []).map(phoneNumber => ({
          phone: normalizeLiveBridgePhone(phoneNumber.number),
          keys: liveBridgePhoneKeys(phoneNumber.number),
          name: `${contact.givenName || ""} ${contact.familyName || ""}`.trim()
            || contact.displayName || "Kişi",
        })),
      );
      const deduped = Array.from(new Map(
        raw.filter(item => item.phone.length >= 7).map(item => [item.phone, item]),
      ).values());
      const response = await fetch(`${SERVER_URL}/livebridge/contacts/match`, {
        method: "POST",
        headers: getApiJsonHeaders(),
        body: JSON.stringify({ownerPhone: directoryPhone, contacts: deduped.slice(0, 3000)}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Kişiler eşleştirilemedi.");
      setDirectoryUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (error) {
      Alert.alert("Kişiler yüklenemedi", error instanceof Error ? error.message : "Telefon rehberi okunamadı.");
    } finally {
      setDirectoryLoading(false);
    }
  }, [directoryPhone, directoryProfileReady]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const load = async () => {
      try {
        const saved = await AsyncStorage.getItem(LIVEBRIDGE_PROFILE_KEY);
        if (!saved || cancelled) return;
        const parsed = JSON.parse(saved) as {phone?: string; gender?: "male" | "female"};
        const phone = normalizeLiveBridgePhone(parsed.phone || "");
        if (parsed.gender === "male" || parsed.gender === "female") setVoiceGender(parsed.gender);
        if (phone.length >= 7) {
          setDirectoryPhone(phone);
          setDirectoryProfileReady(true);
          setTimeout(() => void registerDirectoryProfile(phone), 100);
        }
      } catch {}
    };
    void load();
    return () => { cancelled = true; };
  }, [registerDirectoryProfile, visible]);

  useEffect(() => {
    if (!visible || !directoryProfileReady || !directoryPhone) {
      return;
    }

    const timer = setTimeout(() => {
      void syncLiveBridgeContacts();
    }, 900);

    return () => clearTimeout(timer);
  }, [
    directoryPhone,
    directoryProfileReady,
    syncLiveBridgeContacts,
    visible,
  ]);

  useEffect(() => {
    if (!visible || !directoryProfileReady || !directoryPhone) return;
    const heartbeat = async () => {
      try {
        await fetch(`${SERVER_URL}/livebridge/presence`, {
          method: "POST",
          headers: getApiJsonHeaders(),
          body: JSON.stringify({
            phone: directoryPhone,
            phoneKeys: liveBridgePhoneKeys(directoryPhone),
            name: name.trim() || "LiveBridge Kullanıcısı",
            language: sourceCallLanguage.name,
            gender: voiceGender,
            fcmToken: await getSafeFcmToken(),
          }),
        });
      } catch {}
    };
    void heartbeat();
    const timer = setInterval(() => void heartbeat(), 15000);
    return () => clearInterval(timer);
  }, [directoryPhone, directoryProfileReady, name, sourceCallLanguage.name, visible]);

  useEffect(() => {
    if (!visible || !directoryProfileReady || !directoryPhone || credentials) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`${SERVER_URL}/livebridge/call/incoming?phone=${encodeURIComponent(directoryPhone)}`, {headers: getApiAuthHeaders()});
        const data = await response.json();
        if (!cancelled && response.ok) setIncomingCall(data?.call || null);
      } catch {}
    };
    void poll();
    const timer = setInterval(() => void poll(), 1800);
    return () => { cancelled = true; clearInterval(timer); };
  }, [credentials, directoryPhone, directoryProfileReady, visible]);

  const participantIdentity = useMemo(
    () =>
      `${name.trim().toLowerCase().replace(/\s+/g, "-") || "user"}-${Date.now()
        .toString(36)
        .slice(-5)}`,
    [name],
  );

  const qrInviteValue = useMemo(
    () => (roomCode ? createQrInvite(roomCode) : ""),
    [roomCode],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ["qr"],
    onCodeScanned: codes => {
      if (qrScanLocked) {
        return;
      }

      const scannedValue = codes[0]?.value;
      const scannedRoom = parseQrInvite(scannedValue || "");

      if (!scannedRoom) {
        setQrScanLocked(true);
        Alert.alert(
          "Geçersiz QR",
          "Bu QR bir AyTalk görüşme daveti değil.",
          [
            {
              text: "Tekrar Tara",
              onPress: () => setQrScanLocked(false),
            },
          ],
        );
        return;
      }

      setQrScanLocked(true);
      setRoomCode(scannedRoom);
      setError("");
      setQrScannerVisible(false);

      setTimeout(() => {
        setQrScanLocked(false);
        Alert.alert(
          "QR okundu",
          `${scannedRoom} odası hazır. Şimdi “Odaya Katıl” düğmesine bas.`,
        );
      }, 250);
    },
  });

  const openQrScanner = async () => {
    try {
      let permissionGranted = hasQrCameraPermission;

      if (!permissionGranted) {
        permissionGranted = await requestQrCameraPermission();
      }

      if (!permissionGranted) {
        Alert.alert(
          "Kamera izni gerekli",
          "QR görüşme davetini taramak için kamera iznini aç.",
        );
        return;
      }

      if (!qrCameraDevice) {
        Alert.alert("Kamera bulunamadı", "Arka kamera kullanılamıyor.");
        return;
      }

      setQrScanLocked(false);
      setQrScannerVisible(true);
    } catch (scanError) {
      Alert.alert(
        "QR tarayıcı açılamadı",
        scanError instanceof Error
          ? scanError.message
          : "Bilinmeyen kamera hatası.",
      );
    }
  };

  const showQrInvite = () => {
    let activeRoom = normalizeRoomCode(roomCode);

    if (activeRoom.length < 4) {
      activeRoom = `AY-${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;
      setRoomCode(activeRoom);
    }

    setError("");
    setQrInviteVisible(true);
  };

  const shareQrInvite = async () => {
    const activeRoom = normalizeRoomCode(roomCode);

    if (activeRoom.length < 4) {
      Alert.alert("Oda kodu gerekli", "Önce bir QR daveti oluştur.");
      return;
    }

    try {
      await Share.share({
        message:
          `LiveBridge görüşmesine katıl.\n\n` +
          `Oda: ${activeRoom}\n` +
          `${createQrInvite(activeRoom)}`,
      });
    } catch {
      Alert.alert("Paylaşım hatası", "Görüşme daveti paylaşılamadı.");
    }
  };

  const requestCallPermissions = async (mode: LiveBridgeCallMode): Promise<boolean> => {
    if (Platform.OS !== "android") {
      return true;
    }

    if (mode === "chat") {
      return true;
    }

    const permissions =
      mode === "video"
        ? [
            PermissionsAndroid.PERMISSIONS.CAMERA,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ]
        : [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];

    const result = await PermissionsAndroid.requestMultiple(
      permissions,
    );

    const cameraGranted =
      mode !== "video" ||
      result[PermissionsAndroid.PERMISSIONS.CAMERA] ===
        PermissionsAndroid.RESULTS.GRANTED;
    const microphoneGranted =
      result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
      PermissionsAndroid.RESULTS.GRANTED;

    if (!cameraGranted || !microphoneGranted) {
      Alert.alert(
        "İzin gerekli",
        mode === "video"
          ? "Görüntülü görüşme için kamera ve mikrofon izinlerini aç."
          : "Sesli görüşme için mikrofon iznini aç.",
      );
      return false;
    }

    return true;
  };

  const connectToRoom = async (requestedRoom: string, mode: LiveBridgeCallMode) => {
    const cleanName = name.trim();
    const cleanRoom = normalizeRoomCode(requestedRoom);
    if (!cleanName || cleanRoom.length < 4) {
      setError("Geçerli isim ve oda bilgisi gerekli.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      setConnectionStatus("preparing");
      setActiveCallMode(mode);
      setRoomCode(cleanRoom);
      const permissionsGranted = await requestCallPermissions(mode);
      if (!permissionsGranted) return;
      if (mode !== "chat") {
        await AudioSession.startAudioSession();
        if (AyAudioRoute) {
          await AyAudioRoute.setSpeakerEnabled(true);
        }
      }
      const result = await getLiveKitCredentials({
        roomName: cleanRoom,
        participantIdentity,
        participantName: cleanName,
      });
      setConnectionStatus("connecting");
      setCredentials(result);
    } catch (error) {
      await AudioSession.stopAudioSession();
      setConnectionStatus("idle");
      setError(error instanceof Error ? error.message : "Görüşmeye bağlanılamadı.");
    } finally {
      setLoading(false);
    }
  };

  const connect = async () => {
    await connectToRoom(roomCode, "video");
  };

  const startDirectCall = async (user: LiveBridgeDirectoryUser, mode: LiveBridgeCallMode) => {
    if (!directoryProfileReady || !directoryPhone) return;
    setSelectedDirectoryUser(null);
    if (mode === "video" && !DEMO_VIP_VIDEO_UNLOCKED) {
      Alert.alert("LiveBridge VIP", "Görüntülü LiveBridge görüşmesi VIP üyeliğe dahildir.");
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/livebridge/call/start`, {
        method: "POST",
        headers: getApiJsonHeaders(),
        body: JSON.stringify({
          callerPhone: directoryPhone,
          callerName: name.trim() || "LiveBridge Kullanıcısı",
          calleePhone: user.phone,
          mode,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Arama başlatılamadı.");
      setOutgoingCall({
        id: data.call.id,
        roomName: data.call.roomName,
        calleePhone: user.phone,
        calleeName: user.name,
        calleeGender: data.call.calleeGender === "male" ? "male" : "female",
        mode,
        status: "ringing",
      });
    } catch (error) {
      Alert.alert("Arama başlatılamadı", error instanceof Error ? error.message : "LiveBridge araması başlatılamadı.");
    }
  };

  const respondIncomingCall = async (accepted: boolean) => {
    if (!incomingCall) return;
    const current = incomingCall;
    setIncomingCall(null);
    try {
      const response = await fetch(`${SERVER_URL}/livebridge/call/respond`, {
        method: "POST",
        headers: getApiJsonHeaders(),
        body: JSON.stringify({callId: current.id, calleePhone: directoryPhone, accepted}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Arama yanıtlanamadı.");
      if (accepted) await connectToRoom(current.roomName, current.mode);
    } catch (error) {
      Alert.alert("Gelen arama", error instanceof Error ? error.message : "Arama yanıtlanamadı.");
    }
  };


  useEffect(() => {
    if (!outgoingCall || credentials) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`${SERVER_URL}/livebridge/call/status/${encodeURIComponent(outgoingCall.id)}`, {headers: getApiAuthHeaders()});
        const data = await response.json();
        if (!response.ok || cancelled) return;
        const status = data?.call?.status;
        if (status === "accepted") {
          const accepted = outgoingCall;
          setOutgoingCall(null);
          void connectToRoom(accepted.roomName, accepted.mode);
        } else if (status === "rejected" || status === "expired") {
          setOutgoingCall(null);
          Alert.alert(status === "rejected" ? "Arama reddedildi" : "Arama cevaplanmadı",
            `${outgoingCall.calleeName} görüşmeye katılmadı.`);
        }
      } catch {}
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [credentials, outgoingCall]);

  const createRoomCode = () => {
    const code = `AY-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
    setRoomCode(code);
    setError("");
    setQrInviteVisible(true);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}>
      {credentials ? (
        <LiveKitRoom
          serverUrl={credentials.serverUrl}
          token={credentials.participantToken}
          connect={true}
          audio={activeCallMode !== "chat"}
          video={activeCallMode === "video"}
          options={{
            adaptiveStream: {pixelDensity: "screen"},
            dynacast: true,
            stopLocalTrackOnUnpublish: false,
            audioCaptureDefaults: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 48000,
            },
            publishDefaults: {
              // Konuşma için müzik preset'i yerine speech preset'i kullan.
              audioPreset: AudioPresets.speech,
              dtx: true,
              red: true,
              forceStereo: false,
              stopMicTrackOnMute: true,
            },
          }}
          onConnected={() => {
            setConnectionStatus("connected");
            setError("");
          }}
          onError={roomError => {
            const message =
              roomError instanceof Error
                ? roomError.message
                : "LiveKit bağlantı hatası.";
            // Geçici mikrofon/medya hatasında görüşme ekranını zorla kapatma.
            // Gerçek bağlantı kopması onDisconnected tarafından yönetilir.
            setError(message);
            Alert.alert("Görüşme bağlantı uyarısı", message);
          }}
          onMediaDeviceFailure={failure => {
            const message = `Medya aygıtı hatası: ${String(
              failure ?? "bilinmiyor",
            )}`;

            setError(message);
            Alert.alert("Kamera/Mikrofon hatası", message);
          }}
          onDisconnected={() => {
            setConnectionStatus("idle");
            setCredentials(null);
            void AudioSession.stopAudioSession();
          }}>
          <RoomView
            sourceLanguage={sourceCallLanguage}
            targetLanguage={targetCallLanguage}
            participantName={name.trim() || "LiveBridge Kullanıcısı"}
            callMode={activeCallMode}
            bridgeDistance={activeBridgeDistance}
            onChangeSourceLanguage={language => {
              const index = CALL_LANGUAGES.findIndex(
                item => item.locale === language.locale,
              );
              if (index >= 0) {
                setSourceLanguageIndex(index);
              }
            }}
            onChangeTargetLanguage={language => {
              const index = CALL_LANGUAGES.findIndex(
                item => item.locale === language.locale,
              );
              if (index >= 0) {
                setTargetLanguageIndex(index);
              }
            }}
            onLeave={() => {
              setConnectionStatus("idle");
              setCredentials(null);
              void AudioSession.stopAudioSession();
            }}
          />
        </LiveKitRoom>
      ) : (
        <SafeAreaViewSafe style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={onClose}>
              <Text style={styles.backText}>‹</Text>
            </TouchableOpacity>

            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle}>LiveBridge</Text>
            </View>
          </View>

          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {!directoryProfileReady ? (
              <View style={styles.directorySetupCard}>
                <Text style={styles.directorySetupEyebrow}>LIVEBRIDGE KİŞİLER</Text>
                <Text style={styles.directorySetupTitle}>Rehberindeki LiveBridge kullanıcılarını bul</Text>
                <Text style={styles.directorySetupText}>
                  Demo için numaranı ülke koduyla kaydet.
                </Text>
                <TextInput
                  style={styles.directoryPhoneInput}
                  value={directoryPhone}
                  onChangeText={value =>
                    setDirectoryPhone(
                      normalizeLiveBridgePhone(value),
                    )
                  }
                  placeholder="Telefon numaran"
                  placeholderTextColor="#607A9B"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  importantForAutofill="yes"
                  maxLength={18}
                />
                <TouchableOpacity style={styles.directoryRegisterButton}
                  onPress={() => void registerDirectoryProfile()}>
                  <Text style={styles.directoryRegisterButtonText}>LiveBridge'e Kaydol</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.directoryHeaderRow}>
                  <View>
                    <Text style={styles.directoryTitle}>Kişiler</Text>
                    <Text style={styles.directorySubtitle}>LiveBridge kullanan rehber kişilerin</Text>
                  </View>
                  <TouchableOpacity style={styles.directorySyncButton}
                    onPress={() => void syncLiveBridgeContacts()}>
                    {directoryLoading ? <ActivityIndicator size="small" color="#4BC6FF" />
                      : <CallControlIcon name="loading" size={22} />}
                  </TouchableOpacity>
                </View>

                <View style={styles.freeVipLegend}>
                  <View style={styles.freeLegendChip}>
                    <CallControlIcon name="speaker" size={18} />
                    <Text style={styles.freeLegendText}>
                      Sesli + Çeviri · Ücretsiz
                    </Text>
                  </View>
                  <View style={styles.vipLegendChip}>
                    <CallControlIcon name="camera" size={18} />
                    <Text style={styles.vipLegendText}>
                      Görüntülü · VIP
                    </Text>
                  </View>
                </View>

                {contactsPermissionDenied ? (
                  <View style={styles.directoryEmptyCard}>
                    <Text style={styles.directoryEmptyTitle}>Kişi izni kapalı</Text>
                    <Text style={styles.directoryEmptyText}>LiveBridge kullanıcılarını bulmak için kişi iznini aç.</Text>
                  </View>
                ) : directoryUsers.length > 0 ? (
                  <View style={styles.directoryListCard}>
                    {directoryUsers.map(user => (
                      <TouchableOpacity
                        key={user.phone}
                        activeOpacity={0.88}
                        style={styles.directoryUserRow}
                        onPress={() => setSelectedDirectoryUser(user)}>
                        <View style={styles.directoryAvatar}>
                          <Text style={styles.directoryAvatarText}>
                            {(user.name || "?").slice(0,1).toUpperCase()}
                          </Text>
                          <View
                            style={[
                              styles.directoryPresenceDot,
                              !user.online &&
                                styles.directoryPresenceDotOffline,
                            ]}
                          />
                        </View>

                        <View style={styles.directoryUserInfo}>
                          <Text style={styles.directoryUserName}>
                            {user.name}
                          </Text>
                          <Text style={styles.directoryUserPresence}>
                            {user.online
                              ? "Çevrimiçi"
                              : formatPresence(user.lastSeen)}
                            {user.language ? ` · ${user.language}` : ""}
                          </Text>
                        </View>

                        <View style={styles.directoryChevron}>
                          <Text style={styles.directoryChevronText}>›</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <View style={styles.directoryEmptyCard}>
                    <Text style={styles.directoryEmptyTitle}>LiveBridge kişilerini tara</Text>
                    <Text style={styles.directoryEmptyText}>
                      Diğer telefonda da numarayı LiveBridge'e kaydet. Numara +90, 0, +855 gibi farklı biçimde kayıtlı olsa da eşleştirme yapılır. Sonra ↻ düğmesine dokun.
                    </Text>
                  </View>
                )}
              </>
            )}

            <View style={styles.directoryFallbackDivider}>
              <View style={styles.advancedDividerLine} />
              <Text style={styles.directoryFallbackText}>DİĞER BAĞLANTI SEÇENEKLERİ</Text>
              <View style={styles.advancedDividerLine} />
            </View>

            <View style={styles.qrActionGrid}>
              <TouchableOpacity
                style={styles.qrPrimaryCard}
                onPress={showQrInvite}>
                <View style={styles.qrActionIconWrap}>
                  <CallControlIcon name="message" size={31} />
                </View>
                <Text style={styles.qrActionTitle}>Davet Oluştur</Text>
                <Text style={styles.qrActionDescription}>
                  QR kod üret ve paylaş
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.qrSecondaryCard}
                onPress={() => void openQrScanner()}>
                <View style={styles.qrActionIconWrap}>
                  <Text style={styles.qrActionIcon}>⌑</Text>
                </View>
                <Text style={styles.qrActionTitle}>QR Tara</Text>
                <Text style={styles.qrActionDescription}>
                  Kamerayla daveti okut
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.advancedDivider}>
              <View style={styles.advancedDividerLine} />
              <Text style={styles.advancedDividerText}>KODLA KATIL</Text>
              <View style={styles.advancedDividerLine} />
            </View>

            <Text style={styles.label}>Görünen ad</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Adın"
              placeholderTextColor="#7F9AB9"
              maxLength={40}
            />

            <Text style={styles.label}>Ses cinsiyeti (AI seslendirirken)</Text>
            <View style={{flexDirection: "row", gap: 10}}>
              <TouchableOpacity
                onPress={() => setVoiceGender("female")}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
                  backgroundColor: voiceGender === "female" ? "#3D7DFF" : "rgba(255,255,255,0.06)",
                  borderWidth: 1, borderColor: voiceGender === "female" ? "#3D7DFF" : "rgba(255,255,255,0.12)",
                }}>
                <Text style={{color: "#FFFFFF", fontWeight: "600"}}>👩 Kadın</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setVoiceGender("male")}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
                  backgroundColor: voiceGender === "male" ? "#3D7DFF" : "rgba(255,255,255,0.06)",
                  borderWidth: 1, borderColor: voiceGender === "male" ? "#3D7DFF" : "rgba(255,255,255,0.12)",
                }}>
                <Text style={{color: "#FFFFFF", fontWeight: "600"}}>👨 Erkek</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Oda kodu</Text>
            <TextInput
              style={styles.input}
              value={roomCode}
              onChangeText={value => setRoomCode(normalizeRoomCode(value))}
              placeholder="Örnek: AY-7KD92P"
              placeholderTextColor="#7F9AB9"
              autoCapitalize="characters"
              maxLength={24}
            />

            <Text style={styles.label}>Görüşme dilleri</Text>
            <View style={styles.languageSelectRow}>
              <TouchableOpacity
                style={styles.languageSelectCard}
                onPress={() => openLanguagePicker("source")}>
                <Text style={styles.languageSelectLabel}>BENİM DİLİM</Text>
                <Text style={styles.languageSelectFlag}>
                  {sourceCallLanguage.flag}
                </Text>
                <Text style={styles.languageSelectName}>
                  {sourceCallLanguage.nativeName}
                </Text>
              </TouchableOpacity>

              <Text style={styles.languageDirection}>→</Text>

              <TouchableOpacity
                style={styles.languageSelectCard}
                onPress={() => openLanguagePicker("target")}>
                <Text style={styles.languageSelectLabel}>ÇEVİRİ DİLİ</Text>
                <Text style={styles.languageSelectFlag}>
                  {targetCallLanguage.flag}
                </Text>
                <Text style={styles.languageSelectName}>
                  {targetCallLanguage.nativeName}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.languageSelectHint}>
              61 dilden seçim yapmak için dil kartına dokun.
            </Text>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={createRoomCode}>
                <Text style={styles.secondaryButtonText}>Kod + QR Üret</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.disabled]}
                onPress={connect}
                disabled={loading}>
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {connectionStatus === "preparing"
                      ? "İzinler hazırlanıyor"
                      : connectionStatus === "connecting"
                        ? "Bağlanıyor"
                        : "Görüşmeye Katıl"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {connectionStatus !== "idle" ? (
              <View style={styles.connectionStatusCard}>
                <ActivityIndicator size="small" color="#4BC6FF" />
                <Text style={styles.connectionStatusText}>
                  {connectionStatus === "preparing"
                    ? "Kamera, mikrofon ve ses hazırlanıyor..."
                    : connectionStatus === "connecting"
                      ? "LiveKit odasına bağlanılıyor..."
                      : "Görüşmeye bağlandın."}
                </Text>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.securityRow}>
              <Text style={styles.securityIcon}>🛡️</Text>
              <Text style={styles.securityText}>
                Görüşmeler güvenli bağlantıyla korunur.
              </Text>
            </View>
          </ScrollView>
        </SafeAreaViewSafe>
      )}

      <Modal
        visible={selectedDirectoryUser !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedDirectoryUser(null)}>
        <View style={styles.contactActionBackdrop}>
          <View style={styles.contactActionCard}>
            <View style={styles.contactActionAvatar}>
              <Text style={styles.contactActionAvatarText}>
                {(selectedDirectoryUser?.name || "?")
                  .slice(0, 1)
                  .toUpperCase()}
              </Text>
            </View>
            <Text style={styles.contactActionName}>
              {selectedDirectoryUser?.name}
            </Text>
            <Text style={styles.contactActionPresence}>
              {selectedDirectoryUser?.online
                ? "Çevrimiçi"
                : formatPresence(selectedDirectoryUser?.lastSeen)}
            </Text>

            <View style={styles.contactActionButtons}>
              <TouchableOpacity
                style={styles.contactActionButton}
                onPress={() =>
                  selectedDirectoryUser &&
                  void startDirectCall(
                    selectedDirectoryUser,
                    "chat",
                  )
                }>
                <CallControlIcon name="message" size={30} />
                <Text style={styles.contactActionButtonTitle}>
                  Mesaj
                </Text>
                <Text style={styles.contactActionButtonSub}>
                  Çeviri + dosya
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.contactActionButton}
                onPress={() =>
                  selectedDirectoryUser &&
                  void startDirectCall(
                    selectedDirectoryUser,
                    "audio",
                  )
                }>
                <CallControlIcon name="speaker" size={30} />
                <Text style={styles.contactActionButtonTitle}>
                  Sesli
                </Text>
                <Text style={styles.contactActionButtonSub}>
                  Ücretsiz
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.contactActionButton,
                  styles.contactActionVip,
                ]}
                onPress={() =>
                  selectedDirectoryUser &&
                  void startDirectCall(
                    selectedDirectoryUser,
                    "video",
                  )
                }>
                <CallControlIcon name="camera" size={30} />
                <Text style={styles.contactActionButtonTitle}>
                  Görüntülü
                </Text>
                <Text style={styles.contactActionButtonSubVip}>
                  VIP
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.contactActionClose}
              onPress={() => setSelectedDirectoryUser(null)}>
              <Text style={styles.contactActionCloseText}>
                Kapat
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={outgoingCall !== null} transparent animationType="fade"
        onRequestClose={() => setOutgoingCall(null)}>
        <View style={styles.callInviteBackdrop}>
          <View style={styles.outgoingCallCard}>
            <View style={styles.outgoingCallAvatar}>
              <CallControlIcon name={outgoingCall?.mode === "video" ? "camera" : outgoingCall?.mode === "chat" ? "message" : "speaker"} size={42} />
            </View>
            <Text style={styles.outgoingCallName}>{outgoingCall?.calleeName}</Text>
            <Text style={styles.outgoingCallStatus}>
              {outgoingCall?.mode === "video"
                ? "VIP görüntülü LiveBridge aranıyor..."
                : outgoingCall?.mode === "chat"
                  ? "LiveBridge mesaj bağlantısı kuruluyor..."
                  : "Ücretsiz sesli + çevirili arama..."}
            </Text>
            <ActivityIndicator size="small" color="#4BC6FF" />
            <TouchableOpacity style={styles.outgoingCancelButton} onPress={() => setOutgoingCall(null)}>
              <CallControlIcon name="hangup" size={20} danger /><Text style={styles.outgoingCancelText}>İptal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={incomingCall !== null} transparent animationType="fade"
        onRequestClose={() => void respondIncomingCall(false)}>
        <View style={styles.callInviteBackdrop}>
          <View style={styles.incomingCallCard}>
            <Text style={styles.incomingCallEyebrow}>
              {incomingCall?.mode === "video"
                ? "LIVEBRIDGE VIP"
                : incomingCall?.mode === "chat"
                  ? "LIVEBRIDGE MESAJ"
                  : "LIVEBRIDGE ÜCRETSİZ"}
            </Text>
            <View style={styles.incomingCallAvatar}>
              <CallControlIcon name={incomingCall?.mode === "video" ? "camera" : incomingCall?.mode === "chat" ? "message" : "speaker"} size={42} />
            </View>
            <Text style={styles.incomingCallName}>{incomingCall?.callerName}</Text>
            <Text style={styles.incomingCallText}>
              {incomingCall?.mode === "video"
                ? "Görüntülü görüşme"
                : incomingCall?.mode === "chat"
                  ? "Mesajlaşma ve dosya paylaşımı"
                  : "Sesli + canlı çevirili görüşme"}
            </Text>
            <View style={styles.incomingCallActions}>
              <TouchableOpacity style={styles.incomingRejectButton} onPress={() => void respondIncomingCall(false)}>
                <Text style={styles.incomingCallActionIcon}>✕</Text><Text style={styles.incomingCallActionLabel}>Reddet</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.incomingAcceptButton} onPress={() => void respondIncomingCall(true)}>
                <CallControlIcon
                  name={
                    incomingCall?.mode === "video"
                      ? "camera"
                      : incomingCall?.mode === "chat"
                        ? "message"
                        : "speaker"
                  }
                  size={23}
                />
                <Text style={styles.incomingCallActionLabel}>Kabul</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={languagePickerMode !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLanguagePickerMode(null)}>
        <View style={styles.languageModalBackdrop}>
          <View style={styles.languageModalCard}>
            <View style={styles.languageModalHeader}>
              <View>
                <Text style={styles.languageModalTitle}>
                  {languagePickerMode === "source"
                    ? "Benim Dilim"
                    : "Çeviri Dili"}
                </Text>
                <Text style={styles.languageModalSubtitle}>
                  61 dil arasından seç
                </Text>
              </View>

              <TouchableOpacity
                style={styles.languageModalClose}
                onPress={() => setLanguagePickerMode(null)}>
                <Text style={styles.languageModalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.languageSearchInput}
              value={languageSearch}
              onChangeText={setLanguageSearch}
              placeholder="Dil ara..."
              placeholderTextColor="#607A9B"
              autoCorrect={false}
            />

            <FlatList
              data={filteredCallLanguages}
              keyExtractor={item => item.name}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.languageListContent}
              renderItem={({item}) => {
                const selected =
                  languagePickerMode === "source"
                    ? sourceCallLanguage.name === item.name
                    : targetCallLanguage.name === item.name;

                return (
                  <TouchableOpacity
                    style={[
                      styles.languageListItem,
                      selected && styles.languageListItemSelected,
                    ]}
                    onPress={() => chooseCallLanguage(item)}>
                    <Text style={styles.languageListFlag}>{item.flag}</Text>

                    <View style={styles.languageListTextWrap}>
                      <Text style={styles.languageListNative}>
                        {item.nativeName}
                      </Text>
                      <Text style={styles.languageListEnglish}>
                        {item.name} · {item.locale}
                      </Text>
                    </View>

                    {selected ? (
                      <Text style={styles.languageListCheck}>✓</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={qrInviteVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQrInviteVisible(false)}>
        <View style={styles.qrModalBackdrop}>
          <View style={styles.qrInviteModal}>
            <Text style={styles.qrModalTitle}>LiveBridge Daveti</Text>
            <Text style={styles.qrModalSubtitle}>
              Karşı taraf LiveBridge içinden bu QR'ı tarasın
            </Text>

            <View style={styles.qrCodeCard}>
              {qrInviteValue ? (
                <QRCode
                  value={qrInviteValue}
                  size={220}
                  backgroundColor="#FFFFFF"
                  color="#071226"
                  ecl="M"
                />
              ) : null}
            </View>

            <Text style={styles.qrRoomCode}>{roomCode}</Text>
            <Text style={styles.qrSecurityText}>
              QR yalnızca oda kimliğini taşır. LiveKit anahtarı veya gizli
              token içermez.
            </Text>

            <View style={styles.qrModalActions}>
              <TouchableOpacity
                style={styles.qrShareButton}
                onPress={() => void shareQrInvite()}>
                <Text style={styles.qrShareButtonText}>Daveti Paylaş</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.qrCloseButton}
                onPress={() => setQrInviteVisible(false)}>
                <Text style={styles.qrCloseButtonText}>Kapat</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={qrScannerVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setQrScannerVisible(false)}>
        <SafeAreaViewSafe style={styles.qrScannerContainer}>
          <View style={styles.qrScannerHeader}>
            <View>
              <Text style={styles.qrScannerTitle}>QR Görüşme Daveti</Text>
              <Text style={styles.qrScannerSubtitle}>
                QR kodu çerçevenin içine hizala
              </Text>
            </View>

            <TouchableOpacity
              style={styles.qrScannerClose}
              onPress={() => setQrScannerVisible(false)}>
              <Text style={styles.qrScannerCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          {qrCameraDevice ? (
            <View style={styles.qrCameraArea}>
              <Camera
                style={StyleSheet.absoluteFill}
                device={qrCameraDevice}
                isActive={qrScannerVisible}
                codeScanner={codeScanner}
              />

              <View style={styles.qrScanFrame}>
                <View style={styles.qrCornerTopLeft} />
                <View style={styles.qrCornerTopRight} />
                <View style={styles.qrCornerBottomLeft} />
                <View style={styles.qrCornerBottomRight} />
              </View>

              <View style={styles.qrScanHint}>
                <Text style={styles.qrScanHintText}>
                  LiveBridge görüşme QR'ını okut
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.qrCameraUnavailable}>
              <Text style={styles.qrCameraUnavailableText}>
                Kamera kullanılamıyor.
              </Text>
            </View>
          )}
        </SafeAreaViewSafe>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: "#050A18"},
  header: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    backgroundColor: "#071226",
    borderBottomWidth: 1,
    borderBottomColor: "#20365C",
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#132341",
  },
  backText: {color: "#FFFFFF", fontSize: 34, lineHeight: 38},
  headerTextWrap: {marginLeft: 12},
  headerTitle: {color: "#FFFFFF", fontSize: 19, fontWeight: "900"},
  headerSubtitle: {color: "#7F9AB9", fontSize: 11, marginTop: 2},
  contentScroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  label: {
    color: "#AFC7E6",
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 7,
    marginTop: 8,
  },
  input: {
    minHeight: 48,
    borderRadius: 15,
    paddingHorizontal: 14,
    color: "#FFFFFF",
    backgroundColor: "#0E1C39",
    borderWidth: 1,
    borderColor: "#20365C",
    fontSize: 15,
  },
  languageSelectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  languageSelectCard: {
    flex: 1,
    minHeight: 78,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "#0E1C39",
    borderWidth: 1,
    borderColor: "#315FA8",
    padding: 9,
  },
  languageSelectLabel: {
    color: "#7F9AB9",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  languageSelectFlag: {
    fontSize: 22,
    marginTop: 5,
  },
  languageSelectName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 3,
    textAlign: "center",
  },
  languageDirection: {
    color: "#4BC6FF",
    fontSize: 22,
    fontWeight: "900",
  },
  languageSelectHint: {
    color: "#607A9B",
    fontSize: 9,
    textAlign: "center",
    marginTop: 6,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
  secondaryButton: {
    minWidth: 145,
    flex: 1,
    minHeight: 52,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#132E62",
    borderWidth: 1,
    borderColor: "#315FA8",
  },
  secondaryButtonText: {color: "#4BC6FF", fontWeight: "900"},
  primaryButton: {
    minWidth: 145,
    flex: 1,
    minHeight: 52,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E56FF",
  },
  primaryButtonText: {color: "#FFFFFF", fontWeight: "900"},
  disabled: {opacity: 0.6},
  connectionStatusCard: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    paddingHorizontal: 13,
    marginTop: 12,
    backgroundColor: "#0E1C39",
    borderWidth: 1,
    borderColor: "#315FA8",
  },
  connectionStatusText: {
    flex: 1,
    color: "#AFC7E6",
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 10,
  },
  error: {
    color: "#FF7A87",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  securityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    paddingBottom: 4,
  },
  securityIcon: {
    fontSize: 15,
    marginRight: 7,
  },
  securityText: {
    color: "#7F9AB9",
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
  },
  directorySetupCard: {borderRadius: 22,padding: 17,marginBottom: 16,backgroundColor: "#0B1730",borderWidth: 1,borderColor: "#315FA8"},
  directorySetupEyebrow: {color: "#4BC6FF",fontSize: 9,fontWeight: "900",letterSpacing: 1.3},
  directorySetupTitle: {color: "#FFFFFF",fontSize: 19,lineHeight: 24,fontWeight: "900",marginTop: 6},
  directorySetupText: {color: "#9DB5D2",fontSize: 11,lineHeight: 17,marginTop: 6},
  directoryPhoneInput: {minHeight: 50,borderRadius: 15,paddingHorizontal: 14,marginTop: 14,color: "#FFFFFF",backgroundColor: "#0E1C39",borderWidth: 1,borderColor: "#20365C",fontSize: 15},
  directoryRegisterButton: {minHeight: 50,borderRadius: 15,alignItems: "center",justifyContent: "center",marginTop: 10,backgroundColor: "#1E56FF"},
  directoryRegisterButtonText: {color: "#FFFFFF",fontSize: 13,fontWeight: "900"},
  directoryHeaderRow: {flexDirection: "row",alignItems: "center",justifyContent: "space-between",marginBottom: 10},
  directoryTitle: {color: "#FFFFFF",fontSize: 22,fontWeight: "900"},
  directorySubtitle: {color: "#7F9AB9",fontSize: 10,marginTop: 2},
  directorySyncButton: {width: 44,height: 44,borderRadius: 22,alignItems: "center",justifyContent: "center",backgroundColor: "#132341",borderWidth: 1,borderColor: "#315FA8"},
  directorySyncButtonText: {color: "#4BC6FF",fontSize: 24,fontWeight: "900"},
  freeVipLegend: {flexDirection: "row",gap: 8,marginBottom: 10},
  freeLegendChip: {flex: 1,minHeight: 34,alignItems: "center",justifyContent: "center",borderRadius: 12,backgroundColor: "rgba(34,215,122,0.10)",borderWidth: 1,borderColor: "rgba(34,215,122,0.35)"},
  freeLegendText: {color: "#65E6A0",fontSize: 9,fontWeight: "900"},
  vipLegendChip: {flex: 1,minHeight: 34,alignItems: "center",justifyContent: "center",borderRadius: 12,backgroundColor: "rgba(139,92,255,0.11)",borderWidth: 1,borderColor: "rgba(139,92,255,0.40)"},
  vipLegendText: {color: "#C8B5FF",fontSize: 9,fontWeight: "900"},
  directoryListCard: {borderRadius: 20,overflow: "hidden",backgroundColor: "#0B1730",borderWidth: 1,borderColor: "#20365C"},
  contactActionBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,16,0.78)",
  },
  contactActionCard: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 20,
    paddingBottom: 28,
    alignItems: "center",
    backgroundColor: "#071226",
    borderTopWidth: 1,
    borderColor: "#315FA8",
  },
  contactActionAvatar: {
    width: 72, height: 72, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#17315C",
    borderWidth: 1, borderColor: "#35D8FF",
  },
  contactActionAvatarText: {
    color: "#FFFFFF", fontSize: 28, fontWeight: "900",
  },
  contactActionName: {
    color: "#FFFFFF", fontSize: 21, fontWeight: "900", marginTop: 10,
  },
  contactActionPresence: {
    color: "#6E9ACD", fontSize: 10, marginTop: 3,
  },
  contactActionButtons: {
    width: "100%", flexDirection: "row", gap: 8, marginTop: 20,
  },
  contactActionButton: {
    flex: 1, minHeight: 104, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#0B1730",
    borderWidth: 1, borderColor: "#244B7E",
  },
  contactActionVip: {
    borderColor: "#6F4BCA", backgroundColor: "#151338",
  },
  contactActionButtonTitle: {
    color: "#FFFFFF", fontSize: 12, fontWeight: "900", marginTop: 7,
  },
  contactActionButtonSub: {
    color: "#6E9ACD", fontSize: 8, marginTop: 2,
  },
  contactActionButtonSubVip: {
    color: "#CFACFF", fontSize: 8, fontWeight: "900", marginTop: 2,
  },
  contactActionClose: {
    marginTop: 14, minWidth: 120, minHeight: 40,
    borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: "#101C31",
  },
  contactActionCloseText: {
    color: "#A7BCD4", fontSize: 11, fontWeight: "900",
  },
  directoryChevron: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#0D2344",
    borderWidth: 1, borderColor: "#275EAD",
  },
  directoryChevronText: {
    color: "#31D7FF", fontSize: 27, lineHeight: 28, marginTop: -3,
  },
  chatUtilityRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 6,
  },
  chatPlusButton: {
    width: 48, height: 48, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#102A57",
    borderWidth: 1, borderColor: "#35D8FF",
  },
  chatPlusText: {
    color: "#35D8FF", fontSize: 29, lineHeight: 30, fontWeight: "300",
  },
  chatPdfButton: {
    width: 48, height: 48, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#24194E",
    borderWidth: 1, borderColor: "#765FFF",
  },
  chatPdfText: {
    color: "#C4B4FF", fontSize: 9, fontWeight: "900",
  },
  attachmentBubble: {
    minHeight: 58, maxWidth: "92%", borderRadius: 17,
    padding: 10, marginTop: 8, flexDirection: "row",
    alignItems: "center", borderWidth: 1,
  },
  attachmentBubbleLocal: {
    alignSelf: "flex-end", backgroundColor: "#102A57", borderColor: "#215CA5",
  },
  attachmentBubbleRemote: {
    alignSelf: "flex-start", backgroundColor: "#11182E", borderColor: "#39336C",
  },
  attachmentTextWrap: {flex: 1, minWidth: 0, marginLeft: 8},
  attachmentName: {
    color: "#FFFFFF", fontSize: 11, fontWeight: "900",
  },
  attachmentMeta: {
    color: "#7087A5", fontSize: 8, marginTop: 2,
  },
  attachmentShareButton: {
    minWidth: 54, minHeight: 32, borderRadius: 10,
    alignItems: "center", justifyContent: "center", backgroundColor: "#102B58",
  },
  attachmentShareText: {
    color: "#35D8FF", fontSize: 8, fontWeight: "900",
  },
  attachmentProgressWrap: {
    borderRadius: 14, padding: 10, marginTop: 8, backgroundColor: "#0B1730",
  },
  attachmentProgressText: {
    color: "#8CB9F5", fontSize: 9, fontWeight: "800",
  },
  attachmentProgressTrack: {
    height: 4, borderRadius: 2, backgroundColor: "#162B49",
    marginTop: 7, overflow: "hidden",
  },
  attachmentProgressFill: {
    height: 4, borderRadius: 2, backgroundColor: "#35D8FF",
  },
  inCallLanguageBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "rgba(1,5,14,0.88)",
  },
  inCallLanguageModal: {
    maxHeight: "82%",
    borderRadius: 24,
    padding: 14,
    backgroundColor: "#071226",
    borderWidth: 1,
    borderColor: "#315FA8",
  },
  inCallLanguageModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inCallLanguageModalTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  inCallLanguageModalSubtitle: {
    color: "#6E88AA",
    fontSize: 8,
    marginTop: 2,
  },
  inCallLanguageCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101D32",
  },
  inCallLanguageCloseButtonText: {
    color: "#FFFFFF",
    fontSize: 24,
    lineHeight: 27,
  },
  inCallLanguageSearch: {
    height: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    marginTop: 12,
    color: "#FFFFFF",
    backgroundColor: "#0B1730",
    borderWidth: 1,
    borderColor: "#203E6A",
  },
  inCallLanguageList: {
    marginTop: 8,
  },
  inCallLanguageItem: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 10,
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0B1730",
    borderWidth: 1,
    borderColor: "transparent",
  },
  inCallLanguageItemSelected: {
    borderColor: "#2DD4FF",
    backgroundColor: "rgba(45,212,255,0.10)",
  },
  inCallLanguageItemFlag: {
    fontSize: 20,
    width: 34,
  },
  inCallLanguageItemTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  inCallLanguageItemName: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  inCallLanguageItemEnglish: {
    color: "#6885A8",
    fontSize: 8,
    marginTop: 2,
  },
  inCallLanguageItemLocale: {
    color: "#5F7798",
    fontSize: 8,
    fontWeight: "800",
    marginLeft: 6,
  },
  attachmentMenuBackdrop: {
    flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.50)",
  },
  attachmentMenuCard: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 18, paddingBottom: 28, backgroundColor: "#071226",
    borderTopWidth: 1, borderColor: "#315FA8",
  },
  attachmentMenuTitle: {
    color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginBottom: 10,
  },
  attachmentMenuItem: {
    minHeight: 62, flexDirection: "row", alignItems: "center",
    borderRadius: 18, paddingHorizontal: 12, marginTop: 7,
    backgroundColor: "#0B1730",
    borderWidth: 1, borderColor: "#1C3558",
  },
  attachmentMenuItemIcon: {
    width: 42, color: "#35D8FF", fontSize: 14, fontWeight: "900",
  },
  attachmentMenuItemTitle: {
    color: "#FFFFFF", fontSize: 12, fontWeight: "900",
  },
  attachmentMenuItemSub: {
    color: "#7087A5", fontSize: 8, marginTop: 2,
  },
  directoryUserRow: {minHeight: 76,flexDirection: "row",alignItems: "center",paddingHorizontal: 12,borderBottomWidth: 1,borderBottomColor: "#152541"},
  directoryAvatar: {width: 46,height: 46,borderRadius: 23,alignItems: "center",justifyContent: "center",backgroundColor: "#17315C",borderWidth: 1,borderColor: "#315FA8"},
  directoryAvatarText: {color: "#FFFFFF",fontSize: 18,fontWeight: "900"},
  directoryPresenceDot: {position: "absolute",right: -1,bottom: 1,width: 11,height: 11,borderRadius: 6,backgroundColor: "#22D77A",borderWidth: 2,borderColor: "#0B1730"},
  directoryPresenceDotOffline: {backgroundColor: "#5A6A7F"},
  directoryUserInfo: {flex: 1,minWidth: 0,marginLeft: 11},
  directoryUserName: {color: "#FFFFFF",fontSize: 14,fontWeight: "900"},
  directoryUserPresence: {color: "#7F9AB9",fontSize: 9,marginTop: 3},
  directoryAudioCallButton: {width: 42,height: 42,borderRadius: 21,alignItems: "center",justifyContent: "center",marginLeft: 5,backgroundColor: "rgba(34,215,122,0.14)",borderWidth: 1,borderColor: "rgba(34,215,122,0.45)"},
  directoryVideoCallButton: {width: 48,height: 42,borderRadius: 21,alignItems: "center",justifyContent: "center",marginLeft: 6,backgroundColor: "rgba(139,92,255,0.14)",borderWidth: 1,borderColor: "rgba(139,92,255,0.50)"},
  directoryCallIcon: {color: "#FFFFFF",fontSize: 18,fontWeight: "900"},
  directoryVipMini: {position: "absolute",right: -2,top: -4,color: "#FFFFFF",fontSize: 6,fontWeight: "900",backgroundColor: "#7C4DFF",borderRadius: 6,paddingHorizontal: 4,paddingVertical: 2},
  directoryEmptyCard: {borderRadius: 18,padding: 16,backgroundColor: "#0B1730",borderWidth: 1,borderColor: "#20365C"},
  directoryEmptyTitle: {color: "#FFFFFF",fontSize: 14,fontWeight: "900"},
  directoryEmptyText: {color: "#8FA8C5",fontSize: 10,lineHeight: 16,marginTop: 5},
  directoryFallbackDivider: {flexDirection: "row",alignItems: "center",marginTop: 20,marginBottom: 12},
  directoryFallbackText: {color: "#607A9B",fontSize: 8,fontWeight: "900",letterSpacing: 0.8,marginHorizontal: 9},
  callInviteBackdrop: {flex: 1,alignItems: "center",justifyContent: "center",padding: 20,backgroundColor: "rgba(0,0,0,0.82)"},
  outgoingCallCard: {width: "100%",maxWidth: 360,alignItems: "center",borderRadius: 28,padding: 24,backgroundColor: "#071226",borderWidth: 1,borderColor: "#315FA8"},
  outgoingCallAvatar: {width: 88,height: 88,borderRadius: 44,alignItems: "center",justifyContent: "center",backgroundColor: "#17315C",borderWidth: 2,borderColor: "#4BC6FF"},
  outgoingCallAvatarText: {color: "#FFFFFF",fontSize: 34,fontWeight: "900"},
  outgoingCallName: {color: "#FFFFFF",fontSize: 22,fontWeight: "900",marginTop: 14},
  outgoingCallStatus: {color: "#AFC7E6",fontSize: 11,textAlign: "center",marginTop: 6,marginBottom: 16},
  outgoingCancelButton: {minWidth: 120,minHeight: 44,alignItems: "center",justifyContent: "center",borderRadius: 15,marginTop: 18,backgroundColor: "#341923"},
  outgoingCancelText: {color: "#FF8B98",fontSize: 12,fontWeight: "900"},
  incomingCallCard: {width: "100%",maxWidth: 360,alignItems: "center",borderRadius: 30,padding: 24,backgroundColor: "#071226",borderWidth: 1,borderColor: "#315FA8"},
  incomingCallEyebrow: {color: "#4BC6FF",fontSize: 9,fontWeight: "900",letterSpacing: 1.4},
  incomingCallAvatar: {width: 94,height: 94,borderRadius: 47,alignItems: "center",justifyContent: "center",marginTop: 16,backgroundColor: "#17315C",borderWidth: 2,borderColor: "#4BC6FF"},
  incomingCallAvatarText: {color: "#FFFFFF",fontSize: 36,fontWeight: "900"},
  incomingCallName: {color: "#FFFFFF",fontSize: 23,fontWeight: "900",marginTop: 14},
  incomingCallText: {color: "#AFC7E6",fontSize: 11,marginTop: 5},
  incomingCallActions: {width: "100%",flexDirection: "row",justifyContent: "space-around",marginTop: 24},
  incomingRejectButton: {width: 80,height: 80,borderRadius: 40,alignItems: "center",justifyContent: "center",backgroundColor: "#C93648"},
  incomingAcceptButton: {width: 80,height: 80,borderRadius: 40,alignItems: "center",justifyContent: "center",backgroundColor: "#159E5B"},
  incomingCallActionIcon: {color: "#FFFFFF",fontSize: 25,fontWeight: "900"},
  incomingCallActionLabel: {color: "#FFFFFF",fontSize: 9,fontWeight: "900",marginTop: 3},
  audioCallBackdrop: {flex: 1,alignItems: "center",justifyContent: "center",backgroundColor: "#06101E"},
  audioCallAvatar: {width: 142,height: 142,borderRadius: 71,alignItems: "center",justifyContent: "center",backgroundColor: "#122746",borderWidth: 2,borderColor: "#315FA8"},
  audioCallAvatarText: {fontSize: 62},
  audioCallModeTitle: {color: "#FFFFFF",fontSize: 22,fontWeight: "900",marginTop: 18},
  audioCallModeSubtitle: {color: "#65E6A0",fontSize: 11,fontWeight: "800",marginTop: 5},
  qrActionGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  qrPrimaryCard: {
    flex: 1,
    minHeight: 112,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    padding: 13,
    backgroundColor: "#12356B",
    borderWidth: 1,
    borderColor: "#4BC6FF",
  },
  qrSecondaryCard: {
    flex: 1,
    minHeight: 112,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    padding: 13,
    backgroundColor: "#171A48",
    borderWidth: 1,
    borderColor: "#8B5CFF",
  },
  qrActionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  qrActionIcon: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  qrActionTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 10,
  },
  qrActionDescription: {
    color: "#BFD4EC",
    fontSize: 9,
    lineHeight: 13,
    textAlign: "center",
    marginTop: 4,
  },
  advancedDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  advancedDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#20365C",
  },
  advancedDividerText: {
    color: "#607A9B",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginHorizontal: 10,
  },
  languageModalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  languageModalCard: {
    height: "78%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: "#071226",
    borderTopWidth: 1,
    borderColor: "#315FA8",
  },
  languageModalHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  languageModalTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  languageModalSubtitle: {
    color: "#7F9AB9",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 3,
  },
  languageModalClose: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#132341",
  },
  languageModalCloseText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  languageSearchInput: {
    minHeight: 48,
    borderRadius: 15,
    paddingHorizontal: 14,
    marginTop: 8,
    marginBottom: 10,
    color: "#FFFFFF",
    backgroundColor: "#0E1C39",
    borderWidth: 1,
    borderColor: "#20365C",
    fontSize: 14,
  },
  languageListContent: {
    paddingBottom: 20,
  },
  languageListItem: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 15,
    paddingHorizontal: 12,
    marginBottom: 7,
    backgroundColor: "#0B1730",
    borderWidth: 1,
    borderColor: "#172C4A",
  },
  languageListItemSelected: {
    backgroundColor: "#12356B",
    borderColor: "#4BC6FF",
  },
  languageListFlag: {
    width: 42,
    fontSize: 24,
  },
  languageListTextWrap: {
    flex: 1,
  },
  languageListNative: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  languageListEnglish: {
    color: "#7F9AB9",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  languageListCheck: {
    color: "#4BC6FF",
    fontSize: 20,
    fontWeight: "900",
  },
  qrModalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    backgroundColor: "rgba(0,0,0,0.78)",
  },
  qrInviteModal: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 26,
    alignItems: "center",
    padding: 20,
    backgroundColor: "#0B1730",
    borderWidth: 1,
    borderColor: "#315FA8",
  },
  qrModalTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  qrModalSubtitle: {
    color: "#AFC7E6",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 5,
  },
  qrCodeCard: {
    borderRadius: 20,
    padding: 15,
    backgroundColor: "#FFFFFF",
    marginTop: 18,
  },
  qrRoomCode: {
    color: "#4BC6FF",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginTop: 15,
  },
  qrSecurityText: {
    color: "#7F9AB9",
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginTop: 8,
  },
  qrModalActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  qrShareButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E56FF",
  },
  qrShareButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  qrCloseButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#132341",
  },
  qrCloseButtonText: {
    color: "#AFC7E6",
    fontSize: 13,
    fontWeight: "900",
  },
  qrScannerContainer: {
    flex: 1,
    backgroundColor: "#050A18",
  },
  qrScannerHeader: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    backgroundColor: "#071226",
    borderBottomWidth: 1,
    borderBottomColor: "#20365C",
  },
  qrScannerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  qrScannerSubtitle: {
    color: "#7F9AB9",
    fontSize: 10,
    marginTop: 3,
  },
  qrScannerClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#132341",
  },
  qrScannerCloseText: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
  },
  qrCameraArea: {
    flex: 1,
    overflow: "hidden",
  },
  qrScanFrame: {
    position: "absolute",
    width: 250,
    height: 250,
    alignSelf: "center",
    top: "27%",
  },
  qrCornerTopLeft: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 52,
    height: 52,
    borderLeftWidth: 5,
    borderTopWidth: 5,
    borderColor: "#4BC6FF",
    borderTopLeftRadius: 18,
  },
  qrCornerTopRight: {
    position: "absolute",
    right: 0,
    top: 0,
    width: 52,
    height: 52,
    borderRightWidth: 5,
    borderTopWidth: 5,
    borderColor: "#4BC6FF",
    borderTopRightRadius: 18,
  },
  qrCornerBottomLeft: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: 52,
    height: 52,
    borderLeftWidth: 5,
    borderBottomWidth: 5,
    borderColor: "#4BC6FF",
    borderBottomLeftRadius: 18,
  },
  qrCornerBottomRight: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 52,
    height: 52,
    borderRightWidth: 5,
    borderBottomWidth: 5,
    borderColor: "#4BC6FF",
    borderBottomRightRadius: 18,
  },
  qrScanHint: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 54,
    alignItems: "center",
  },
  qrScanHintText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    backgroundColor: "rgba(5,10,24,0.78)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  qrCameraUnavailable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  qrCameraUnavailableText: {
    color: "#AFC7E6",
    fontSize: 14,
  },
  roomContainer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  callStage: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#000000",
  },
  remoteVideo: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "#000000",
  },
  remotePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 34,
    backgroundColor: "#071226",
  },
  remoteAvatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#132341",
    borderWidth: 2,
    borderColor: "#315FA8",
  },
  remoteAvatarIcon: {
    fontSize: 54,
  },
  remoteWaitingTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 18,
  },
  remoteWaitingText: {
    color: "#AFC7E6",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 7,
  },
  callTopOverlay: {
    position: "absolute",
    left: 18,
    top: 16,
    minWidth: 170,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: "rgba(3,6,12,0.84)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  roomHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  roomTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  callStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 5,
  },
  callStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#19D77C",
    marginRight: 7,
  },
  roomSubtitle: {
    color: "#D8E0EA",
    fontSize: 11,
    fontWeight: "700",
  },
  topMoreButton: {
    position: "absolute",
    right: 16,
    top: 22,
    width: 52,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  topMoreText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 2,
    marginTop: -4,
  },
  inCallLanguageBar: {
    position: "absolute",
    top: 22,
    left: 205,
    right: 82,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  inCallLanguageChip: {
    flex: 1,
    maxWidth: 110,
    minHeight: 42,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 5,
    justifyContent: "center",
    backgroundColor: "rgba(4,15,32,0.86)",
    borderWidth: 1,
    borderColor: "rgba(49,95,168,0.78)",
  },
  inCallLanguageChipLabel: {
    color: "#607FA7",
    fontSize: 6,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  inCallLanguageChipValue: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    marginTop: 1,
  },
  inCallLanguageDirection: {
    color: "#35D8FF",
    fontSize: 13,
    fontWeight: "900",
  },
  unifiedSubtitlePanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "36%",
    minHeight: 250,
    maxHeight: 360,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 76,
    backgroundColor: "rgba(1,4,9,0.97)",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderTopColor: "#1E2A3D",
  },
  subtitlePanelHandle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#354154",
    marginBottom: 8,
  },
  subtitlePanelHeader: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 3,
  },
  subtitleLanguageSource: {
    color: "#1FA7FF",
    fontSize: 13,
    fontWeight: "900",
  },
  subtitleLanguageArrow: {
    color: "#7E91A9",
    fontSize: 17,
    fontWeight: "900",
    marginHorizontal: 12,
  },
  subtitleLanguageTarget: {
    color: "#23D978",
    fontSize: 13,
    fontWeight: "900",
  },
  subtitleHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  subtitleHeaderButton: {
    position: "absolute",
    right: 0,
    width: 34,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#111A28",
  },
  subtitleHeaderIcon: {
    fontSize: 14,
  },
  subtitleClearButton: {
    display: "none",
  },
  subtitleClearText: {
    color: "#AFC7E6",
    fontSize: 8,
    fontWeight: "800",
  },
  subtitleScroll: {
    flex: 1,
  },
  subtitleScrollContent: {
    paddingBottom: 12,
  },
  subtitleHistoryItem: {
    opacity: 0.58,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#151C27",
  },
  subtitleHistoryItemLatest: {
    opacity: 1,
  },
  subtitleRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
  },
  subtitleLanguageTag: {
    minWidth: 26,
    color: "#1FA7FF",
    fontSize: 11,
    fontWeight: "900",
  },
  subtitleLanguageTagLocal: {
    color: "#22D77A",
  },
  subtitleWave: {
    color: "#1FA7FF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginLeft: 8,
  },
  subtitleWaveLocal: {
    color: "#22D77A",
  },
  subtitleRowSpeakerButton: {
    marginLeft: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(31,167,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(31,167,255,0.35)",
  },
  subtitleRowSpeakerButtonLocal: {
    borderColor: "#22D77A",
    backgroundColor: "rgba(34,215,122,0.12)",
  },
  subtitleSpeaker: {
    color: "#4BC6FF",
    fontSize: 9,
    fontWeight: "900",
  },
  subtitleSpeakerLocal: {
    color: "#B896FF",
  },
  subtitleOriginal: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  subtitleTranslated: {
    color: "#AAB6C7",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    marginTop: 2,
  },
  subtitleState: {
    color: "#FFD166",
    fontSize: 10,
    fontWeight: "900",
    marginTop: 7,
  },
  localPreviewWrap: {
    position: "absolute",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#071226",
    borderWidth: 0,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 7,
    shadowOffset: {width: 0, height: 3},
    elevation: 8,
  },
  localVideo: {
    width: "100%",
    height: "100%",
    backgroundColor: "#071226",
  },
  localPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  localPlaceholderIcon: {
    fontSize: 34,
  },
  localPlaceholderText: {
    color: "#D7E5F5",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 5,
  },
  localPreviewFlipButton: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,7,18,0.82)",
    borderWidth: 1,
    borderColor: "rgba(53,216,255,0.68)",
  },
  localPreviewBadge: {
    position: "absolute",
    left: 8,
    bottom: 8,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(0,0,0,0.68)",
  },
  localPreviewBadgeSignal: {
    color: "#22D77A",
    fontSize: 8,
    marginRight: 5,
  },
  localPreviewBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
  },
  leftControlRail: {
    position: "absolute",
    left: 10,
    top: 118,
    width: 64,
    borderRadius: 30,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.60)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  railControlButton: {
    width: 56,
    minHeight: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    marginVertical: 1,
  },
  railControlIcon: {
    fontSize: 20,
  },
  railControlLabel: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "800",
    marginTop: 3,
    textAlign: "center",
  },
  railControlTranslateActive: {
    backgroundColor: "rgba(31,167,255,0.12)",
  },
  railControlTranslateLabel: {
    color: "#20B8FF",
    fontSize: 8,
    fontWeight: "900",
    marginTop: 3,
  },
  railControlSpeakerActive: {
    backgroundColor: "rgba(34,215,122,0.08)",
  },
  railControlDanger: {
    backgroundColor: "rgba(230,45,68,0.22)",
  },
  callBottomBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 12,
    height: 58,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    backgroundColor: "rgba(14,18,26,0.96)",
    borderWidth: 1,
    borderColor: "#1C2432",
  },
  bottomStatusBlock: {
    minWidth: 76,
  },
  bottomFileButton: {
    minWidth: 48,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(31,167,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(75,198,255,0.34)",
    paddingHorizontal: 8,
  },
  bottomFileText: {
    color: "#73CFFF",
    fontSize: 8,
    fontWeight: "900",
    marginTop: 1,
  },
  bottomStatusLabel: {
    color: "#DDE5EF",
    fontSize: 10,
    fontWeight: "900",
  },
  bottomStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
  },
  bottomStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#22D77A",
    marginRight: 5,
  },
  bottomStatusText: {
    color: "#8EA0B7",
    fontSize: 9,
    fontWeight: "700",
  },  bottomDistanceText: {color:"#7EA9E7",fontSize:7,lineHeight:10,fontWeight:"800",marginTop:2},

  bottomHangupButton: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D92E49",
    borderWidth: 1,
    borderColor: "#FF6675",
    shadowColor: "#FF304D",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 7,
    marginTop: -8,
  },
  bottomHangupIcon: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "900",
    transform: [{rotate: "135deg"}],
  },
  bottomSubtitleButton: {
    minWidth: 94,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  bottomSubtitleIcon: {
    color: "#FFFFFF",
    fontSize: 20,
    marginRight: 6,
  },
  bottomSubtitleText: {
    color: "#DDE5EF",
    fontSize: 9,
    fontWeight: "800",
  },
  translationMainButton: {
    borderColor: "#4BC6FF",
  },
  railControlInactive: {opacity: 0.4},
  audioConversationStage: {
    flex: 1, paddingTop: 96, paddingBottom: 84, paddingHorizontal: 15,
    backgroundColor: "#030817",
  },
  audioConversationHeader: {
    flexDirection: "row", alignItems: "center", borderRadius: 22, padding: 14,
    backgroundColor: "#0B1730", borderWidth: 1, borderColor: "#203E6A",
  },
  audioConversationAvatar: {
    width: 48, height: 48, borderRadius: 16, alignItems: "center",
    justifyContent: "center", backgroundColor: "#102B58",
  },
  audioConversationHeaderText: {flex: 1, marginLeft: 11},
  audioConversationTitle: {color: "#FFF", fontSize: 17, fontWeight: "900"},
  audioConversationSubtitle: {color: "#6E9ACD", fontSize: 9, fontWeight: "700", marginTop: 3},
  audioConversationScroll: {flex: 1, marginTop: 10},
  audioConversationContent: {paddingBottom: 10},
  audioConversationEmpty: {
    borderRadius: 20, padding: 18, marginTop: 8, backgroundColor: "#08142A",
    borderWidth: 1, borderColor: "#182D4D",
  },
  audioConversationEmptyTitle: {color: "#FFF", fontSize: 15, fontWeight: "900"},
  audioConversationEmptyText: {color: "#7992B0", fontSize: 10, lineHeight: 16, marginTop: 6},
  audioMessageBubble: {maxWidth: "89%", borderRadius: 18, padding: 12, marginTop: 8, borderWidth: 1},
  audioMessageBubbleLocal: {alignSelf: "flex-end", backgroundColor: "#102A57", borderColor: "#215CA5"},
  audioMessageBubbleRemote: {alignSelf: "flex-start", backgroundColor: "#11182E", borderColor: "#39336C"},
  audioMessageSender: {color: "#39D5FF", fontSize: 8, fontWeight: "900", letterSpacing: 0.7},
  audioMessageOriginal: {color: "#FFF", fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: 5},
  audioMessageTranslated: {color: "#9FC3EA", fontSize: 14, lineHeight: 20, fontWeight: "800", marginTop: 4},
  audioReplayButton: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", marginTop: 8,
    borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: "rgba(30,88,160,0.22)",
  },
  audioReplayText: {color: "#73CFFF", fontSize: 8, fontWeight: "900", marginLeft: 4},
  audioConversationState: {alignSelf: "center", color: "#FFD166", fontSize: 10, fontWeight: "900", marginVertical: 7},
  audioChatComposer: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 16,
    padding: 4,
    backgroundColor: "#0B1730",
    borderWidth: 1,
    borderColor: "#203E6A",
  },
  audioChatInput: {
    flex: 1, maxHeight: 92, minHeight: 42, color: "#FFF", fontSize: 12, lineHeight: 17,
    paddingHorizontal: 10, paddingVertical: 9,
  },
  audioChatSendButton: {
    minWidth: 66, minHeight: 42, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: "#126EDB", borderWidth: 1, borderColor: "#35D8FF",
  },
  audioChatSendButtonDisabled: {opacity: 0.38},
  audioChatSendText: {color: "#FFF", fontSize: 10, fontWeight: "900"},
  moreMenuIconWrap: {
    width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: "#102A57", marginRight: 10,
  },
  moreMenuTextWrap: {flex: 1},
  moreMenuSubtext: {color: "#7087A5", fontSize: 9, lineHeight: 13, marginTop: 2},
  moreMenuBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  moreMenuSheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    backgroundColor: "#071226",
    borderTopWidth: 1,
    borderColor: "#315FA8",
  },
  moreMenuHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
    backgroundColor: "#315FA8",
  },
  moreMenuTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
  },
  moreMenuItem: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 15,
    paddingHorizontal: 13,
    marginTop: 7,
    backgroundColor: "#0E1C39",
    borderWidth: 1,
    borderColor: "#20365C",
  },
  moreMenuIcon: {
    width: 36,
    fontSize: 20,
  },
  moreMenuText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  profanitySection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#18283F",
  },
  profanityTitle: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  profanityHint: {
    color: "#708AA8",
    fontSize: 8,
    marginTop: 3,
  },
  profanityModeRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 9,
  },
  profanityModeButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101B2D",
    borderWidth: 1,
    borderColor: "#243A59",
  },
  profanityModeButtonActive: {
    backgroundColor: "rgba(45,212,255,0.13)",
    borderColor: "#2DD4FF",
  },
  profanityModeText: {
    color: "#7891AF",
    fontSize: 9,
    fontWeight: "900",
  },
  profanityModeTextActive: {
    color: "#35D8FF",
  },
  moreMenuLanguageActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  moreMenuLanguageButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101B2D",
    borderWidth: 1,
    borderColor: "#243A59",
  },
  moreMenuLanguageButtonText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    textAlign: "center",
  },
  moreMenuLanguageArrow: {
    color: "#35D8FF",
    fontSize: 14,
    fontWeight: "900",
  },
  moreMenuLanguageInfo: {
    borderRadius: 15,
    padding: 13,
    marginTop: 12,
    backgroundColor: "#101A34",
  },
  moreMenuLanguageLabel: {
    color: "#7F9AB9",
    fontSize: 9,
    fontWeight: "900",
  },
  moreMenuLanguageValue: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 5,
  },
});
