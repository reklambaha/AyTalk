import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Buffer} from "buffer";
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import notifee from "@notifee/react-native";
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
import {fetchJson} from "../../../services/api";
import CallControlIcon from "../components/CallControlIcon";
import {prepareSpeech} from "../../language-engine";

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
  callerLanguage?: string;
  calleePhone: string;
  calleeLanguage?: string;
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
  calleeLanguage?: string;
  mode: LiveBridgeCallMode;
  status: "ringing" | "accepted" | "rejected" | "expired";
};
const LIVEBRIDGE_PROFILE_KEY = "livebridge_demo_profile_v1";
const LIVEBRIDGE_CONTACTS_KEY_PREFIX = "livebridge_saved_contacts_v2:";
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
  voiceGender?: "male" | "female";
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
  id:string;side:"local"|"remote";name:string;mimeType:string;localPath:string;remoteUrl?:string;size:number;createdAt:number;
};
type LiveBridgeRecentConversation = {
  peerPhone: string;
  peerName: string;
  peerOnline?: boolean;
  lastKind: "text" | "file";
  lastText: string;
  updatedAt: number;
};
type LiveBridgeStoredMessage = {
  id: string;
  senderPhone: string;
  recipientPhone: string;
  senderName?: string;
  kind: "text" | "file";
  originalText?: string;
  translatedText?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  createdAt: number;
  url?: string;
};

type AyPdfModule = {
  createConversationPdf(title: string, lines: string[]): Promise<string>;
};

type AyFileModule = {
  zipDirectory(treeUri: string, outputName: string): Promise<string>;
};

const AyPdf = NativeModules.AyPdf as AyPdfModule | undefined;
const AyFile = NativeModules.AyFile as AyFileModule | undefined;
const FILE_STREAM_TOPIC = "aytalk-file-v2";

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
function liveBridgeContactsStorageKey(ownerPhone: string): string {
  return `${LIVEBRIDGE_CONTACTS_KEY_PREFIX}${normalizeLiveBridgePhone(ownerPhone)}`;
}

function mergeLiveBridgeUsers(
  ...groups: Array<LiveBridgeDirectoryUser[] | undefined>
): LiveBridgeDirectoryUser[] {
  const byPhone = new Map<string, LiveBridgeDirectoryUser>();
  for (const group of groups) {
    for (const user of group || []) {
      const phone = normalizeLiveBridgePhone(user?.phone || "");
      if (phone.length < 7) continue;
      const old = byPhone.get(phone);
      byPhone.set(phone, {
        ...(old || {}),
        ...user,
        phone,
        name: String(user?.name || old?.name || phone),
        online: Boolean(user?.online),
        lastSeen: Number(user?.lastSeen || old?.lastSeen || 0),
      });
    }
  }
  return Array.from(byPhone.values()).sort((a, b) =>
    a.online === b.online
      ? String(a.name).localeCompare(String(b.name), "tr")
      : a.online
        ? -1
        : 1,
  );
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

function formatBytes(size: number): string {
  const value = Math.max(0, Number(size || 0));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function RoomView({
  onLeave,
  sourceLanguage,
  targetLanguage,
  participantName,
  callMode,
  bridgeDistance,
  remoteVoiceGender,
  ownerPhone,
  peerPhone,
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
  remoteVoiceGender: "male" | "female";
  ownerPhone:string;
  peerPhone:string;
  onChangeSourceLanguage: (language: CallLanguage) => void;
  onChangeTargetLanguage: (language: CallLanguage) => void;
}) {
  useKeepAwake();

  const tracks = useTracks([Track.Source.Camera]);
  const {localParticipant} = useLocalParticipant();
  const room = useRoomContext();
  const {height, width} = useWindowDimensions();

  const translationRequestRef = useRef(false);
  const microphoneWasEnabledRef = useRef(true);
  const autoTranslationEnabledRef = useRef(false);
  const autoTranslationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTranslationRunIdRef = useRef(0);
  const translationCaptureRef = useRef(false);
  const ttsPlaybackRef = useRef(false);
  const ttsCooldownUntilRef = useRef(0);
  const lastRemoteTranslationKeyRef = useRef("");

  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [frontCamera, setFrontCamera] = useState(true);
  const [callSeconds, setCallSeconds] = useState(0);
  const [controlBusy, setControlBusy] = useState(false);
  const [translationListening, setTranslationListening] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [autoTranslationEnabled, setAutoTranslationEnabled] = useState(false);
  const [localOriginal, setLocalOriginal] = useState("");
  const [localTranslated, setLocalTranslated] = useState("");
  const [remoteOriginal, setRemoteOriginal] = useState("");
  const [remoteTranslated, setRemoteTranslated] = useState("");
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [subtitlesVisible, setSubtitlesVisible] = useState(true);
  const [translationHistory, setTranslationHistory] = useState<TranslationEntry[]>([]);
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [voiceTranslationEnabled, setVoiceTranslationEnabled] = useState(true);
  const [translationVoiceGender, setTranslationVoiceGender] =
    useState<"male" | "female">(remoteVoiceGender);
  const translationVoiceGenderRef = useRef<"male" | "female">(remoteVoiceGender);
  const translationVoiceGenderTouchedRef = useRef(false);
  const cloudTranslationSoundRef = useRef<Sound | null>(null);

  const changeTranslationVoiceGender = useCallback((gender:"male"|"female")=>{
    translationVoiceGenderTouchedRef.current = true;
    translationVoiceGenderRef.current = gender;
    setTranslationVoiceGender(gender);
    void AsyncStorage.setItem(
      "livebridge_translation_voice_gender",
      gender,
    ).catch(() => undefined);

    // Eski cinsiyetle çalmakta olan TTS varsa anında durdur.
    const currentSound = cloudTranslationSoundRef.current;
    cloudTranslationSoundRef.current = null;
    if (currentSound) {
      try {
        currentSound.stop(() => {
          try { currentSound.release(); } catch {}
        });
      } catch {
        try { currentSound.release(); } catch {}
      }
    }
  },[]);
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
  const [activeImageAttachment, setActiveImageAttachment] = useState<LiveBridgeAttachment | null>(null);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState(0);
  const [localPreviewPosition, setLocalPreviewPosition] = useState({x: 0, y: 0});
  const localPreviewDragStart = useRef({x: 0, y: 0});
  const subtitleScrollRef = useRef<ScrollView | null>(null);

  const remoteTrack = tracks.find(track => !track.participant.isLocal);
  const localTrack = tracks.find(track => track.participant.isLocal);
  const cameraRecoveryDoneRef = useRef(false);

  useEffect(() => {
    // Profil cinsiyeti yalnız kullanıcı görüşme içinde manuel seçim yapmadıysa başlangıç değeri olur.
    if (translationVoiceGenderTouchedRef.current) return;
    translationVoiceGenderRef.current = remoteVoiceGender;
    setTranslationVoiceGender(remoteVoiceGender);
  }, [remoteVoiceGender]);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem("livebridge_translation_voice_gender")
      .then(saved => {
        if (!mounted) return;
        if (saved !== "male" && saved !== "female") return;
        translationVoiceGenderTouchedRef.current = true;
        translationVoiceGenderRef.current = saved;
        setTranslationVoiceGender(saved);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (
      callMode !== "video" ||
      !videoConversationEnabled ||
      !cameraEnabled ||
      !remoteTrack ||
      cameraRecoveryDoneRef.current
    ) {
      return;
    }

    cameraRecoveryDoneRef.current = true;
    const timer = setTimeout(() => {
      const publication = localParticipant.getTrackPublication(Track.Source.Camera);
      const healthy = Boolean(publication?.track && !publication.isMuted);
      if (healthy) return;

      void (async () => {
        try {
          await localParticipant.setCameraEnabled(false);
          await new Promise<void>(resolve => setTimeout(resolve, 140));
          await localParticipant.setCameraEnabled(true);
          setCameraEnabled(true);
          setVideoConversationEnabled(true);
        } catch {}
      })();
    }, 650);

    return () => clearTimeout(timer);
  }, [
    cameraEnabled,
    callMode,
    localParticipant,
    remoteTrack,
    videoConversationEnabled,
  ]);

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
      autoTranslationEnabledRef.current = false;
      autoTranslationRunIdRef.current += 1;
      if (autoTranslationTimerRef.current) {
        clearTimeout(autoTranslationTimerRef.current);
        autoTranslationTimerRef.current = null;
      }
      try {
        AySpeech?.cancel();
      } catch {}
      const currentSound = cloudTranslationSoundRef.current;
      cloudTranslationSoundRef.current = null;
      if (currentSound) {
        try {
          currentSound.stop(() => {
            try { currentSound.release(); } catch {}
          });
        } catch {
          try { currentSound.release(); } catch {}
        }
      }
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

  const playCloudTranslation = async (text: string, languageName: string, gender: "male" | "female") => {
    const data = await fetchJson<{audioBase64?: string}>(
      "/tts",
      {
        method: "POST",
        body: JSON.stringify({text, language: languageName, gender}),
      },
      12000,
    );
    const audioBase64 = String(data?.audioBase64 || "");
    if (!audioBase64) throw new Error("Bulut sesi boş döndü.");
    const filePath = `${RNFS.CachesDirectoryPath}/livebridge-tts-${Date.now()}.mp3`;
    await RNFS.writeFile(filePath, audioBase64, "base64");
    await new Promise<void>((resolve, reject) => {
      const sound = new Sound(filePath, "", error => {
        if (error) return reject(error);
        cloudTranslationSoundRef.current = sound;
        sound.setVolume(1);
        sound.play(ok => {
          if (cloudTranslationSoundRef.current === sound) {
            cloudTranslationSoundRef.current = null;
          }
          sound.release();
          void RNFS.unlink(filePath).catch(() => undefined);
          ok ? resolve() : reject(new Error("Ses oynatılamadı."));
        });
      });
    });
  };

  const speakTranslation = async (
    translated: string,
    locale: string,
    explicitGender?: "male" | "female",
  ) => {
    if (!voiceTranslationEnabled || !translated.trim()) return;

    const languageName =
      CALL_LANGUAGES.find(item => item.locale === locale)?.name || locale;
    const selectedGender: "male" | "female" =
      explicitGender || translationVoiceGenderRef.current;

    // AyTalk'ın kendi TTS sesi otomatik çeviri mikrofonuna tekrar girerse
    // TTS -> STT -> çeviri -> TTS geri besleme döngüsü oluşur.
    // Bu yüzden TTS başlamadan aktif capture kesin iptal edilir ve görüşme
    // mikrofonu yalnız oynatma süresince mute edilir. Track odadan sökülmez.
    const micWasEnabled = localParticipant.isMicrophoneEnabled;
    ttsPlaybackRef.current = true;
    ttsCooldownUntilRef.current = Number.MAX_SAFE_INTEGER;

    try {
      try {
        AySpeech?.cancel();
      } catch {}
      translationCaptureRef.current = false;
      setTranslationListening(false);

      if (micWasEnabled) {
        try {
          await localParticipant.setMicrophoneEnabled(false);
          setMicrophoneEnabled(false);
        } catch {}
      }

      await Tts.stop();

      const currentSound = cloudTranslationSoundRef.current;
      cloudTranslationSoundRef.current = null;
      if (currentSound) {
        try {
          currentSound.stop(() => {
            try { currentSound.release(); } catch {}
          });
        } catch {
          try { currentSound.release(); } catch {}
        }
      }

      const voices = await Tts.voices();
      const prepared = prepareSpeech({
        text: translated,
        locale,
        voices,
      });

      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await playCloudTranslation(
            prepared.speechText,
            languageName,
            selectedGender,
          );
          return;
        } catch (error) {
          lastError = error;
          if (attempt === 0) {
            await new Promise<void>(resolve => setTimeout(resolve, 220));
          }
        }
      }

      console.warn(
        "LiveBridge TTS seçilen cinsiyetle üretilemedi:",
        selectedGender,
        lastError,
      );
    } catch (error) {
      console.warn(
        "LiveBridge TTS hatası:",
        selectedGender,
        error,
      );
    } finally {
      // Hoparlör yankısının son kuyruğu da mikrofona girmesin.
      ttsPlaybackRef.current = false;
      ttsCooldownUntilRef.current = Date.now() + 900;

      if (micWasEnabled) {
        try {
          await new Promise<void>(resolve => setTimeout(resolve, 220));
          await localParticipant.setMicrophoneEnabled(true, {
            echoCancellation: true,
            noiseSuppression: true,
            voiceIsolation: true,
            autoGainControl: false,
            channelCount: 1,
          });
          setMicrophoneEnabled(true);
        } catch {}
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    const configureAudioRoute = async () => {
      try {
        if (callMode !== "chat" && AyAudioRoute) {
          await AyAudioRoute.setSpeakerEnabled(true);
        }
        if (!cancelled) {
          setMicrophoneEnabled(callMode !== "chat");
          setSpeakerEnabled(callMode !== "chat");
          setCameraEnabled(callMode === "video");
          setVideoConversationEnabled(callMode === "video");
        }
      } catch (routeError) {
        console.warn("LiveBridge audio route:", routeError);
      }
    };

    void configureAudioRoute();
    return () => {
      cancelled = true;
    };
  }, [callMode]);

  useEffect(()=>{
    const h=(payload:Uint8Array,_p?:unknown,_k?:unknown,topic?:string)=>{
      if(topic&&topic!=="aytalk.translation")return;
      try{
        const packet=JSON.parse(Buffer.from(payload).toString("utf8")) as TranslationPacket;
        if(packet.type!=="aytalk-translation")return;

        const packetKey=`${packet.senderName||""}:${packet.createdAt}:${packet.original}:${packet.translated}`;
        if(lastRemoteTranslationKeyRef.current===packetKey)return;
        lastRemoteTranslationKeyRef.current=packetKey;

        setRemoteOriginal(packet.original);
        setRemoteTranslated(packet.translated);
        setBridgeActivated(true);
        setTranslationHistory(cur=>[...cur,{id:`remote-${packet.createdAt}`,side:"remote",original:packet.original,translated:packet.translated,
        senderName:packet.senderName||"Karşı taraf",createdAt:packet.createdAt}].slice(-120));

        if(voiceTranslationEnabled){
          try{AySpeech?.cancel();}catch{}
          translationCaptureRef.current=false;
          setTranslationListening(false);
          void speakTranslation(
            packet.translated,
            packet.toLocale||targetLanguage.locale,
            translationVoiceGenderRef.current,
          );
        }
      }catch{}
    };
    room.on(RoomEvent.DataReceived,h);
    return()=>room.off(RoomEvent.DataReceived,h);
  },[room,voiceTranslationEnabled,targetLanguage.locale]);

  useEffect(() => {
    if (!ownerPhone || !peerPhone) return;

    let cancelled = false;
    const syncFiles = async () => {
      try {
        const data = await fetchJson<{messages?: LiveBridgeStoredMessage[]}>(
          `/livebridge/chat/history?phone=${encodeURIComponent(
            ownerPhone,
          )}&peerPhone=${encodeURIComponent(peerPhone)}`,
          {method: "GET"},
          12000,
        );
        if (cancelled || !Array.isArray(data?.messages)) return;

        const remoteFiles = data.messages.filter(
          item =>
            item.kind === "file" &&
            item.senderPhone === peerPhone &&
            Boolean(item.url),
        );

        if (remoteFiles.length === 0) return;

        setAttachments(current => {
          const known = new Set(current.map(item => item.id));
          const additions = remoteFiles
            .filter(item => !known.has(item.id))
            .map(item => ({
              id: item.id,
              side: "remote" as const,
              name: item.fileName || "Dosya",
              mimeType: item.mimeType || "application/octet-stream",
              localPath: "",
              remoteUrl: item.url || "",
              size: Number(item.fileSize || 0),
              createdAt: Number(item.createdAt || Date.now()),
            }));

          return additions.length ? [...current, ...additions] : current;
        });
      } catch {}
    };

    void syncFiles();
    const timer = setInterval(() => void syncFiles(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ownerPhone, peerPhone]);

  const restoreCallMicrophone = async () => {
    try {
      if (microphoneWasEnabledRef.current) {
        await new Promise<void>(resolve => {
          setTimeout(() => resolve(), 260);
        });

        await localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          voiceIsolation: true,
          autoGainControl: false,
          channelCount: 1,
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
      // Paket, gönderen telefonun kendi seçtiği çeviri yönünü taşır.
      // Alıcı bu dili kendi ayarına göre yeniden yorumlamaz.
      fromLanguage: sourceLanguage.name,
      toLanguage: targetLanguage.name,
      toLocale: targetLanguage.locale,
      senderName: participantName,
      voiceGender: translationVoiceGenderRef.current,
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
      const data = await fetchJson<{reply?: string}>(
        "/call/translate",
        {
          method: "POST",
          body: JSON.stringify({
            message: cleanText,
            // KRİTİK: Çeviri yönü yalnız bu cihazdaki BEN -> ÇEVİRİ seçimidir.
            // Karşı tarafın profil/dil tercihi bu isteği değiştiremez.
            from: sourceLanguage.name,
            to: targetLanguage.name,
            profanityMode,
            context: translationHistory
              .slice(-16)
              .map(entry => ({
                role: entry.side === "local" ? "speaker" : "other",
                source: entry.original,
                translation: entry.translated,
              })),
          }),
        },
        15000,
      );

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



  const stopAutomaticTranslation = useCallback(async () => {
    autoTranslationEnabledRef.current = false;
    autoTranslationRunIdRef.current += 1;

    if (autoTranslationTimerRef.current) {
      clearTimeout(autoTranslationTimerRef.current);
      autoTranslationTimerRef.current = null;
    }

    try {
      AySpeech?.cancel();
    } catch {}

    setTranslationListening(false);
    setAutoTranslationEnabled(false);
    await restoreCallMicrophone();
  }, []);

  const startPushToTranslate = async (automatic = false, runId?: number) => {
    if (automatic) {
      if (
        !autoTranslationEnabledRef.current ||
        runId !== autoTranslationRunIdRef.current
      ) {
        return;
      }

      const cooldownLeft = Math.max(0, ttsCooldownUntilRef.current - Date.now());
      if (
        ttsPlaybackRef.current ||
        cooldownLeft > 0 ||
        translationCaptureRef.current ||
        translationRequestRef.current ||
        translationListening ||
        translationBusy
      ) {
        if (autoTranslationTimerRef.current) {
          clearTimeout(autoTranslationTimerRef.current);
        }
        autoTranslationTimerRef.current = setTimeout(() => {
          autoTranslationTimerRef.current = null;
          if (
            autoTranslationEnabledRef.current &&
            runId === autoTranslationRunIdRef.current
          ) {
            void startPushToTranslate(true, runId);
          }
        }, Math.max(300, cooldownLeft + 80));
        return;
      }
    } else if (translationListening || translationBusy) {
      try {
        AySpeech?.cancel();
      } catch {}

      setTranslationListening(false);
      await restoreCallMicrophone();
      return;
    }

    if (!AySpeech) {
      if (!automatic) {
        Alert.alert(
          "Ses kayıt modülü bulunamadı",
          "AyTalk yerel ses kayıt modülü yüklenmemiş.",
        );
      }
      return;
    }

    try {
      setLocalOriginal("");
      setLocalTranslated("");

      microphoneWasEnabledRef.current =
        localParticipant.isMicrophoneEnabled;

      // Çeviri capture sırasında LiveKit mikrofon track'ini ODADAN SÖKME.
      // Eski unpublishTrack(..., true) çağrısı track'i yok edip bağlantıyı
      // kararsızlaştırabiliyordu. Yalnızca mute edilir ve aynı track korunur.
      if (microphoneWasEnabledRef.current) {
        try {
          await localParticipant.setMicrophoneEnabled(false);
          setMicrophoneEnabled(false);
        } catch {}
      }

      await new Promise<void>(resolve => {
        setTimeout(() => resolve(), 180);
      });

      if (
        automatic &&
        (!autoTranslationEnabledRef.current ||
          runId !== autoTranslationRunIdRef.current)
      ) {
        return;
      }

      setTranslationListening(true);
      translationCaptureRef.current = true;

      // AySpeech kendi sessizlik algılamasıyla konuşma bittiğinde erken döner;
      // 9 sn yalnızca üst sınırdır.
      const captured = await AySpeech.capture(9000);
      translationCaptureRef.current = false;
      setTranslationListening(false);

      const audioBase64 = String(
        captured?.audioBase64 || "",
      ).trim();

      if (!audioBase64) {
        if (!automatic) {
          throw new Error("Ses kaydı boş geldi.");
        }
        return;
      }

      const data = await fetchJson<{text?: string}>(
        "/audio/transcribe",
        {
          method: "POST",
          body: JSON.stringify({
            audioBase64,
            language: sourceLanguage.locale
              .split("-")[0]
              .toLowerCase(),
          }),
        },
        15000,
      );

      const recognized = String(
        data?.text || "",
      ).trim();

      if (!recognized) {
        if (!automatic) {
          throw new Error("Konuşma algılanmadı.");
        }
        return;
      }

      setLocalOriginal(recognized);
      await translateRecognizedText(recognized);
    } catch (speechError) {
      translationCaptureRef.current = false;
      setTranslationListening(false);

      const message =
        speechError instanceof Error
          ? speechError.message
          : "Ses algılanamadı.";

      // Hands-free modda ortam sessizliği / no-speech normaldir.
      // Sadece gerçek ağ/sistem hatalarını kullanıcıya göster.
      const harmless =
        message.toLowerCase().includes("iptal") ||
        message.toLowerCase().includes("cancel") ||
        message.toLowerCase().includes("algılanmadı") ||
        message.toLowerCase().includes("boş geldi") ||
        message.toLowerCase().includes("sessiz");

      if (!automatic && !harmless) {
        Alert.alert(
          "Konuşma algılama hatası",
          message,
        );
      } else if (!automatic && harmless) {
        Alert.alert(
          "Konuşma algılama",
          message,
        );
      } else if (automatic && !harmless) {
        console.warn("Otomatik çeviri capture:", message);
      }
    } finally {
      translationCaptureRef.current = false;
      await restoreCallMicrophone();

      if (
        automatic &&
        autoTranslationEnabledRef.current &&
        runId === autoTranslationRunIdRef.current
      ) {
        if (autoTranslationTimerRef.current) {
          clearTimeout(autoTranslationTimerRef.current);
        }

        autoTranslationTimerRef.current = setTimeout(() => {
          autoTranslationTimerRef.current = null;
          if (
            autoTranslationEnabledRef.current &&
            runId === autoTranslationRunIdRef.current
          ) {
            void startPushToTranslate(true, runId);
          }
        }, 360);
      }
    }
  };

  const toggleAutomaticTranslation = useCallback(() => {
    if (autoTranslationEnabledRef.current) {
      void stopAutomaticTranslation();
      return;
    }

    autoTranslationRunIdRef.current += 1;
    const runId = autoTranslationRunIdRef.current;
    autoTranslationEnabledRef.current = true;
    setAutoTranslationEnabled(true);
    setBridgeActivated(true);

    if (autoTranslationTimerRef.current) {
      clearTimeout(autoTranslationTimerRef.current);
    }

    autoTranslationTimerRef.current = setTimeout(() => {
      autoTranslationTimerRef.current = null;
      if (
        autoTranslationEnabledRef.current &&
        runId === autoTranslationRunIdRef.current
      ) {
        void startPushToTranslate(true, runId);
      }
    }, 180);
  }, [stopAutomaticTranslation]);


  useEffect(() => {
    if (!autoTranslationEnabledRef.current) return;

    // Dil görüşme sırasında değişirse eski dil ile süren capture iptal edilir.
    // Yeni render'daki startPushToTranslate fonksiyonu ile döngü yeniden başlar.
    const nextRunId = autoTranslationRunIdRef.current + 1;
    autoTranslationRunIdRef.current = nextRunId;

    if (autoTranslationTimerRef.current) {
      clearTimeout(autoTranslationTimerRef.current);
      autoTranslationTimerRef.current = null;
    }

    try {
      AySpeech?.cancel();
    } catch {}

    autoTranslationTimerRef.current = setTimeout(() => {
      autoTranslationTimerRef.current = null;
      if (
        autoTranslationEnabledRef.current &&
        nextRunId === autoTranslationRunIdRef.current
      ) {
        void startPushToTranslate(true, nextRunId);
      }
    }, 320);

    return () => {
      if (autoTranslationTimerRef.current) {
        clearTimeout(autoTranslationTimerRef.current);
        autoTranslationTimerRef.current = null;
      }
    };
  }, [sourceLanguage.locale, targetLanguage.locale]);

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
              voiceIsolation: true,
              autoGainControl: false,
              channelCount: 1,
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


  const sendLocalFile=async({localPath,name,mimeType}:{localPath:string;name:string;mimeType:string})=>{
    if(!ownerPhone||!peerPhone)throw new Error("Aktif kişi bulunamadı.");
    const cleanPath=localPath.replace(/^file:\/\//,""),stat=await RNFS.stat(cleanPath),size=Number(stat.size);
    if(size<=0)throw new Error("Dosya boş.");if(size>6*1024*1024)throw new Error("Dosya sınırı 6 MB.");
    setAttachmentBusy(true);setAttachmentProgress(.1);
    try{const dataBase64=await RNFS.readFile(cleanPath,"base64");setAttachmentProgress(.45);
      const data=await fetchJson<any>("/livebridge/chat/file",{method:"POST",body:JSON.stringify({
        senderPhone:ownerPhone,recipientPhone:peerPhone,senderName:participantName,fileName:name,mimeType,dataBase64})},30000);
      setAttachments(cur=>[...cur,{id:data.message.id,side:"local",name:data.message.fileName||name,mimeType:data.message.mimeType||mimeType,
        localPath:cleanPath,remoteUrl:data.message.url||"",size:Number(data.message.fileSize||size),createdAt:Number(data.message.createdAt||Date.now())}]);
      setAttachmentProgress(1);
    }finally{setAttachmentBusy(false);setTimeout(()=>setAttachmentProgress(0),300);}
  };

  const runWithVideoPickerPause = async <T,>(task: () => Promise<T>) => {
    const shouldRestore =
      callMode === "video" && videoConversationEnabled && cameraEnabled;

    if (shouldRestore) {
      try {
        await localParticipant.setCameraEnabled(false);
        setCameraEnabled(false);
        await new Promise<void>(resolve => setTimeout(resolve, 180));
      } catch {}
    }

    try {
      return await task();
    } finally {
      if (shouldRestore) {
        try {
          await new Promise<void>(resolve => setTimeout(resolve, 160));
          await localParticipant.setCameraEnabled(true);
          setCameraEnabled(true);
        } catch {}
      }
    }
  };

  const pickConversationImage = async () => {
    setAttachmentMenuVisible(false);

    try {
      const result = await runWithVideoPickerPause(() =>
        launchImageLibrary({
          mediaType: "photo",
          selectionLimit: 1,
          quality: 0.62,
          maxWidth: 1280,
          maxHeight: 1280,
        }),
      );

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
      const [file] = await runWithVideoPickerPause(() =>
        pick({
          type: [types.allFiles],
          allowMultiSelection: false,
          mode: "import",
        }).then(items => items),
      );

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
    const uri=attachment.remoteUrl?attachment.remoteUrl:(attachment.localPath.startsWith("file://")?attachment.localPath:`file://${attachment.localPath}`);

    await RNShare.open({
      url: uri,
      type: attachment.mimeType,
      title: attachment.name,
      useInternalStorage: true,
      failOnCancel: false,
    });
  };

  const renderAttachmentBubble = (item: LiveBridgeAttachment) => {
    const isImage = item.mimeType.toLowerCase().startsWith("image/");
    return (
      <View
        key={item.id}
        style={[
          styles.attachmentBubble,
          item.side === "local"
            ? styles.attachmentBubbleLocal
            : styles.attachmentBubbleRemote,
        ]}>
        {isImage ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setActiveImageAttachment(item)}>
            <Image
              source={{
                uri: item.remoteUrl
                  ? item.remoteUrl
                  : item.localPath.startsWith("file://")
                    ? item.localPath
                    : `file://${item.localPath}`,
              }}
              style={styles.attachmentImagePreview}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ) : (
          <CallControlIcon name="message" size={22} />
        )}
        <View style={styles.attachmentTextWrap}>
          <Text style={styles.attachmentName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.attachmentMeta}>
            {item.side === "local" ? "Sen" : "Karşı taraf"} · {formatBytes(item.size)}
          </Text>
          <TouchableOpacity
            style={styles.attachmentShareButton}
            onPress={() =>
              isImage
                ? setActiveImageAttachment(item)
                : void shareAttachment(item)
            }>
            <Text style={styles.attachmentShareText}>
              {isImage ? "Aç" : "Aç / paylaş"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
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
                  Çeviri düğmesine bir kez dokunarak Otomatik modu açın.
                  AyTalk konuşma bittiğinde kendisi çevirir; görüşme sırasında dilleri değiştirebilirsiniz.
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
            {attachments.map(renderAttachmentBubble)}

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
      return <VideoTrack trackRef={remoteTrack} style={styles.remoteVideo} objectFit="contain" />;
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
    if (cameraEnabled && localTrack && isTrackReference(localTrack)) {
      return (
        <VideoTrack
          trackRef={localTrack}
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
        (translationHistory.length > 0 || attachments.length > 0 || translationListening || translationBusy || localOriginal) ? (
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
                style={styles.subtitleVoiceGenderButton}
                onPress={() =>
                  changeTranslationVoiceGender(
                    translationVoiceGender === "female" ? "male" : "female",
                  )
                }>
                <Text style={styles.subtitleVoiceGenderText}>
                  {translationVoiceGender === "female" ? "👩 Kadın" : "👨 Erkek"}
                </Text>
              </TouchableOpacity>

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

              {attachments.map(renderAttachmentBubble)}

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
              autoTranslationEnabled && styles.railControlTranslateActive,
            ]}
            onPress={toggleAutomaticTranslation}>
            <CallControlIcon
              name={
                translationBusy
                  ? "loading"
                  : autoTranslationEnabled
                    ? "stop"
                    : "translate"
              }
              size={25}
            />
            <Text style={styles.railControlTranslateLabel}>
              {autoTranslationEnabled ? "Otomatik" : "Çeviri"}
            </Text>
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

        </View>
        ) : null}

        <View style={styles.callBottomBar}>
          <View style={styles.bottomStatusBlock}>
            <Text style={styles.bottomStatusLabel}>Canlı Çeviri</Text>
            <View style={styles.bottomStatusRow}>
              <View style={styles.bottomStatusDot} />
              <Text style={styles.bottomStatusText}>
                {translationListening
                  ? "Konuşmanı dinliyor"
                  : translationBusy
                    ? "Çeviriyor"
                    : autoTranslationEnabled
                      ? "Otomatik çeviri açık"
                      : bridgeActivated
                        ? "Dil köprüsü hazır"
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
          visible={activeImageAttachment !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setActiveImageAttachment(null)}>
          <View style={styles.imageViewerBackdrop}>
            <TouchableOpacity
              style={styles.imageViewerClose}
              onPress={() => setActiveImageAttachment(null)}>
              <Text style={styles.imageViewerCloseText}>×</Text>
            </TouchableOpacity>
            {activeImageAttachment ? (
              <Image
                source={{
                  uri: activeImageAttachment.remoteUrl
                    ? activeImageAttachment.remoteUrl
                    : activeImageAttachment.localPath.startsWith("file://")
                      ? activeImageAttachment.localPath
                      : `file://${activeImageAttachment.localPath}`,
                }}
                style={styles.imageViewerImage}
                resizeMode="contain"
              />
            ) : null}
            {activeImageAttachment ? (
              <TouchableOpacity
                style={styles.imageViewerShareButton}
                onPress={() => void shareAttachment(activeImageAttachment)}>
                <Text style={styles.imageViewerShareText}>Paylaş / başka uygulamada aç</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Modal>

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

              <TouchableOpacity
                style={styles.moreMenuItem}
                onPress={() => {
                  setMoreMenuVisible(false);
                  setAttachmentMenuVisible(true);
                }}>
                <View style={styles.moreMenuIconWrap}>
                  <CallControlIcon name="message" size={23} />
                </View>
                <View style={styles.moreMenuTextWrap}>
                  <Text style={styles.moreMenuText}>Dosya / Resim gönder</Text>
                  <Text style={styles.moreMenuSubtext}>
                    Fotoğraf, belge ve diğer dosyaları paylaş
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.moreMenuItem}
                onPress={() => {
                  setMoreMenuVisible(false);
                  void exportConversationPdf();
                }}>
                <View style={styles.moreMenuIconWrap}>
                  <Text style={styles.moreMenuPdfIcon}>PDF</Text>
                </View>
                <View style={styles.moreMenuTextWrap}>
                  <Text style={styles.moreMenuText}>Görüşme PDF'i</Text>
                  <Text style={styles.moreMenuSubtext}>
                    Çeviri geçmişini PDF oluştur ve paylaş
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.moreMenuItem,
                  autoTranslationEnabled && styles.moreMenuVoiceButtonActive,
                ]}
                onPress={() => {
                  setMoreMenuVisible(false);
                  toggleAutomaticTranslation();
                }}>
                <CallControlIcon name="translate" size={22} />
                <View style={styles.moreMenuItemTextWrap}>
                  <Text style={styles.moreMenuItemTitle}>
                    Otomatik Çeviri
                  </Text>
                  <Text style={styles.moreMenuItemSub}>
                    {autoTranslationEnabled
                      ? "Açık · konuş ve AyTalk kendisi çevirsin"
                      : "Kapalı · açmak için dokun"}
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={styles.moreMenuVoiceSection}>
                <Text style={styles.moreMenuLanguageLabel}>Çeviri sesi</Text>
                <View style={styles.moreMenuVoiceRow}>
                  <TouchableOpacity
                    style={[
                      styles.moreMenuVoiceButton,
                      translationVoiceGender === "female" &&
                        styles.moreMenuVoiceButtonActive,
                    ]}
                    onPress={() => changeTranslationVoiceGender("female")}>
                    <Text style={styles.moreMenuVoiceText}>👩 Kadın</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.moreMenuVoiceButton,
                      translationVoiceGender === "male" &&
                        styles.moreMenuVoiceButtonActive,
                    ]}
                    onPress={() => changeTranslationVoiceGender("male")}>
                    <Text style={styles.moreMenuVoiceText}>👨 Erkek</Text>
                  </TouchableOpacity>
                </View>
              </View>

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
    CALL_LANGUAGES.findIndex(language => language.name === "English"),
  );

  const [directoryPhone, setDirectoryPhone] = useState("");
  const [directoryProfileReady, setDirectoryProfileReady] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<LiveBridgeDirectoryUser[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [incomingCall, setIncomingCall] = useState<LiveBridgeIncomingCall | null>(null);
  const [outgoingCall, setOutgoingCall] = useState<LiveBridgeOutgoingCall | null>(null);
  const [activeRemoteVoiceGender, setActiveRemoteVoiceGender] =
    useState<"male" | "female">("female");
  const [activeCallMode, setActiveCallMode] = useState<LiveBridgeCallMode>("video");
  const [activePeerPhone, setActivePeerPhone] = useState("");
  const [activePeerName, setActivePeerName] = useState("");
  const [liveBridgeHomeTab, setLiveBridgeHomeTab] =
    useState<"contacts" | "invites" | "chats">("chats");
  const [historyPeer, setHistoryPeer] =
    useState<LiveBridgeRecentConversation | null>(null);
  const [historyMessages, setHistoryMessages] =
    useState<LiveBridgeStoredMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [contactsPermissionDenied, setContactsPermissionDenied] = useState(false);
  const [recentConversations,setRecentConversations]=useState<LiveBridgeRecentConversation[]>([]);
  const [recentLoading,setRecentLoading]=useState(false);
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
  const outgoingRingRef = useRef<Sound | null>(null);
  const incomingRingRef = useRef<Sound | null>(null);
  const outgoingRingGenerationRef = useRef(0);
  const incomingRingGenerationRef = useRef(0);

  const stopLocalRingSound = useCallback((kind: "incoming" | "outgoing") => {
    const ref = kind === "incoming" ? incomingRingRef : outgoingRingRef;
    const generationRef =
      kind === "incoming" ? incomingRingGenerationRef : outgoingRingGenerationRef;
    generationRef.current += 1;

    const sound = ref.current;
    ref.current = null;
    if (!sound) return;
    try {
      sound.stop(() => {
        try { sound.release(); } catch {}
      });
    } catch {
      try { sound.release(); } catch {}
    }
  }, []);

  const startLocalRingSound = useCallback((kind: "incoming" | "outgoing") => {
    const ref = kind === "incoming" ? incomingRingRef : outgoingRingRef;
    const generationRef =
      kind === "incoming" ? incomingRingGenerationRef : outgoingRingGenerationRef;
    if (ref.current) return;

    const generation = generationRef.current + 1;
    generationRef.current = generation;

    try {
      Sound.setCategory?.("Playback");
      const filename =
        kind === "incoming"
          ? "livebridge_ring.wav"
          : "livebridge_ringback.wav";
      const sound = new Sound(filename, Sound.MAIN_BUNDLE, error => {
        if (
          error ||
          ref.current !== sound ||
          generationRef.current !== generation
        ) {
          try { sound.release(); } catch {}
          if (ref.current === sound) ref.current = null;
          return;
        }
        sound.setNumberOfLoops(-1);
        sound.setVolume(kind === "incoming" ? 1 : 0.45);
        sound.play(success => {
          if (!success && ref.current === sound) {
            ref.current = null;
            try { sound.release(); } catch {}
          }
        });
      });
      ref.current = sound;
    } catch {}
  }, []);

  const sourceCallLanguage = CALL_LANGUAGES[sourceLanguageIndex];
  const targetCallLanguage = CALL_LANGUAGES[targetLanguageIndex];

  // Dil yönü tamamen bu cihazın kullanıcısı tarafından seçilir.
  // Karşı tarafın profil dili yerel hedef dili ASLA değiştirmez.
  // Örn. bu telefonda Türkçe -> English seçildiyse, bu telefondan çıkan
  // konuşma yalnız English'e çevrilir; karşı telefon kendi Türkçe -> Deutsch
  // seçimini bağımsız olarak korur.


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
      setActivePeerPhone("");
      setActivePeerName("");
      setLiveBridgeHomeTab("contacts");
    }
  }, [visible]);

  useEffect(() => {
    if (visible) return;
    void AudioSession.stopAudioSession();
  }, [visible]);

  const loadSavedLiveBridgeContacts = useCallback(
    async (ownerOverride?: string) => {
      const owner = normalizeLiveBridgePhone(ownerOverride || directoryPhone);
      if (owner.length < 7) return [] as LiveBridgeDirectoryUser[];

      let localUsers: LiveBridgeDirectoryUser[] = [];
      try {
        const raw = await AsyncStorage.getItem(liveBridgeContactsStorageKey(owner));
        const parsed = raw ? JSON.parse(raw) : [];
        localUsers = Array.isArray(parsed) ? parsed : [];
        if (localUsers.length) {
          setDirectoryUsers(current => mergeLiveBridgeUsers(current, localUsers));
        }
      } catch {}

      try {
        const data = await fetchJson<{users?: LiveBridgeDirectoryUser[]}>(
          `/livebridge/contacts/saved?ownerPhone=${encodeURIComponent(owner)}`,
          {method: "GET"},
          12000,
        );
        const serverUsers = Array.isArray(data?.users) ? data.users : [];
        const merged = mergeLiveBridgeUsers(localUsers, serverUsers);
        setDirectoryUsers(merged);
        await AsyncStorage.setItem(
          liveBridgeContactsStorageKey(owner),
          JSON.stringify(merged),
        );
        return merged;
      } catch {
        return localUsers;
      }
    },
    [directoryPhone],
  );

  const registerDirectoryProfile = useCallback(async (phoneOverride?: string) => {
    const cleanPhone = normalizeLiveBridgePhone(phoneOverride ?? directoryPhone);
    if (cleanPhone.length < 7) {
      Alert.alert("Telefon numarası", "Ülke koduyla birlikte geçerli telefon numaranı yaz.");
      return false;
    }
    try {
      const data = await fetchJson<{user?: unknown}>(
        "/livebridge/profile/register",
        {
          method: "POST",
          body: JSON.stringify({
            phone: cleanPhone,
            phoneKeys: liveBridgePhoneKeys(cleanPhone),
            name: name.trim() || "LiveBridge Kullanıcısı",
            language: sourceCallLanguage.name,
            gender: voiceGender,
            fcmToken: await messaging().getToken().catch(() => ""),
          }),
        },
        12000,
      );
      setDirectoryPhone(cleanPhone);
      setDirectoryProfileReady(true);
      await AsyncStorage.setItem(
        LIVEBRIDGE_PROFILE_KEY,
        JSON.stringify({phone: cleanPhone, gender: voiceGender}),
      );
      void loadSavedLiveBridgeContacts(cleanPhone);
      return true;
    } catch (error) {
      Alert.alert("LiveBridge kayıt hatası", error instanceof Error ? error.message : "Profil kaydedilemedi.");
      return false;
    }
  }, [directoryPhone, loadSavedLiveBridgeContacts, name, sourceCallLanguage.name, voiceGender]);

  const loadRecentConversations=useCallback(async()=>{
    if(!directoryProfileReady||!directoryPhone)return;
    try{setRecentLoading(true);const d=await fetchJson<any>(`/livebridge/chat/recent?phone=${encodeURIComponent(directoryPhone)}`,{method:"GET"},12000);
    setRecentConversations(Array.isArray(d?.recents)?d.recents:[]);}catch{setRecentConversations([]);}finally{setRecentLoading(false);}
  },[directoryPhone,directoryProfileReady]);

  const loadConversationMessages = useCallback(
    async (peerPhone: string, showSpinner = false) => {
      if (!directoryPhone || !peerPhone) return;
      if (showSpinner) setHistoryLoading(true);
      try {
        const data = await fetchJson<{messages?: LiveBridgeStoredMessage[]}>(
          `/livebridge/chat/history?phone=${encodeURIComponent(
            directoryPhone,
          )}&peerPhone=${encodeURIComponent(peerPhone)}`,
          {method: "GET"},
          15000,
        );
        setHistoryMessages(Array.isArray(data?.messages) ? data.messages : []);
      } catch (error) {
        if (showSpinner) {
          Alert.alert(
            "Sohbet geçmişi",
            error instanceof Error ? error.message : "Geçmiş yüklenemedi.",
          );
        }
      } finally {
        if (showSpinner) setHistoryLoading(false);
      }
    },
    [directoryPhone],
  );

  const openConversationHistory = useCallback(
    async (item: LiveBridgeRecentConversation) => {
      if (!directoryPhone) return;
      setHistoryPeer(item);
      setHistoryMessages([]);
      setChatInput("");
      await loadConversationMessages(item.peerPhone, true);
    },
    [directoryPhone, loadConversationMessages],
  );

  const openDirectoryChat = useCallback(
    async (user: LiveBridgeDirectoryUser) => {
      await openConversationHistory({
        peerPhone: user.phone,
        peerName: user.name,
        peerOnline: user.online,
        lastKind: "text",
        lastText: user.online ? "Çevrimiçi" : formatPresence(user.lastSeen),
        updatedAt: Number(user.lastSeen || Date.now()),
      });
    },
    [openConversationHistory],
  );

  const historyPeerAsDirectoryUser = useMemo<LiveBridgeDirectoryUser | null>(
    () =>
      historyPeer
        ? {
            phone: historyPeer.peerPhone,
            name: historyPeer.peerName,
            online: Boolean(historyPeer.peerOnline),
            lastSeen: historyPeer.updatedAt,
          }
        : null,
    [historyPeer],
  );

  const sendPersistentChatText = useCallback(async () => {
    const body = chatInput.trim();
    if (!body || !historyPeer || !directoryPhone || chatSending) return;

    try {
      setChatSending(true);
      setChatInput("");

      await fetchJson(
        "/livebridge/chat/text",
        {
          method: "POST",
          body: JSON.stringify({
            senderPhone: directoryPhone,
            recipientPhone: historyPeer.peerPhone,
            senderName: name.trim() || "AyTalk Kullanıcısı",
            originalText: body,
            translatedText: body,
          }),
        },
        12000,
      );

      await loadConversationMessages(historyPeer.peerPhone);
      void loadRecentConversations();
    } catch (error) {
      setChatInput(body);
      Alert.alert(
        "Mesaj gönderilemedi",
        error instanceof Error ? error.message : "Mesaj gönderilemedi.",
      );
    } finally {
      setChatSending(false);
    }
  }, [
    chatInput,
    chatSending,
    directoryPhone,
    historyPeer,
    loadConversationMessages,
    loadRecentConversations,
    name,
  ]);

  const uploadPersistentChatFile = useCallback(
    async ({
      localPath,
      fileName,
      mimeType,
    }: {
      localPath: string;
      fileName: string;
      mimeType: string;
    }) => {
      if (!historyPeer || !directoryPhone || chatSending) return;

      const cleanPath = localPath.replace(/^file:\/\//, "");
      const stat = await RNFS.stat(cleanPath);
      const size = Number(stat.size || 0);

      if (size <= 0) {
        throw new Error("Dosya boş.");
      }
      if (size > 6 * 1024 * 1024) {
        throw new Error("Sohbet dosyası en fazla 6 MB olabilir.");
      }

      setChatSending(true);
      try {
        const dataBase64 = await RNFS.readFile(cleanPath, "base64");
        await fetchJson(
          "/livebridge/chat/file",
          {
            method: "POST",
            body: JSON.stringify({
              senderPhone: directoryPhone,
              recipientPhone: historyPeer.peerPhone,
              senderName: name.trim() || "AyTalk Kullanıcısı",
              fileName,
              mimeType,
              dataBase64,
            }),
          },
          30000,
        );

        await loadConversationMessages(historyPeer.peerPhone);
        void loadRecentConversations();
      } finally {
        setChatSending(false);
      }
    },
    [
      chatSending,
      directoryPhone,
      historyPeer,
      loadConversationMessages,
      loadRecentConversations,
      name,
    ],
  );

  const choosePersistentChatImage = useCallback(async () => {
    try {
      const response = await launchImageLibrary({
        mediaType: "photo",
        selectionLimit: 1,
        quality: 0.65,
        maxWidth: 1280,
        maxHeight: 1280,
      });
      if (response.didCancel || !response.assets?.[0]?.uri) return;
      const asset = response.assets[0];
      await uploadPersistentChatFile({
        localPath: asset.uri,
        fileName: asset.fileName || `aytalk-${Date.now()}.jpg`,
        mimeType: asset.type || "image/jpeg",
      });
    } catch (error) {
      Alert.alert(
        "Fotoğraf gönderilemedi",
        error instanceof Error ? error.message : "Fotoğraf gönderilemedi.",
      );
    }
  }, [uploadPersistentChatFile]);

  const choosePersistentChatDocument = useCallback(async () => {
    try {
      const picked = await pick({
        type: [types.allFiles],
        allowMultiSelection: false,
      });
      const first = Array.isArray(picked) ? picked[0] : picked;
      if (!first?.uri) return;

      let localPath = first.uri;
      try {
        const copies = await keepLocalCopy({
          files: [
            {
              uri: first.uri,
              fileName: first.name || `dosya-${Date.now()}`,
            },
          ],
          destination: "cachesDirectory",
        });
        const copied = copies?.[0];
        if (copied?.status === "success" && copied.localUri) {
          localPath = copied.localUri;
        }
      } catch {}

      await uploadPersistentChatFile({
        localPath,
        fileName: first.name || `dosya-${Date.now()}`,
        mimeType: first.type || "application/octet-stream",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (!/cancel/i.test(message)) {
        Alert.alert("Dosya gönderilemedi", message || "Dosya gönderilemedi.");
      }
    }
  }, [uploadPersistentChatFile]);

  const openChatAttachmentMenu = useCallback(() => {
    Alert.alert(
      "Gönder",
      "Sohbete ne eklemek istiyorsun?",
      [
        {text: "Fotoğraf", onPress: () => void choosePersistentChatImage()},
        {text: "Dosya", onPress: () => void choosePersistentChatDocument()},
        {text: "Vazgeç", style: "cancel"},
      ],
    );
  }, [choosePersistentChatDocument, choosePersistentChatImage]);


  useEffect(() => {
    if (!historyPeer?.peerPhone || !directoryPhone) return;

    const timer = setInterval(() => {
      void loadConversationMessages(historyPeer.peerPhone);
    }, 3000);

    return () => clearInterval(timer);
  }, [directoryPhone, historyPeer?.peerPhone, loadConversationMessages]);



  const syncLiveBridgeContacts = useCallback(async () => {
    if (!directoryProfileReady || !directoryPhone) return;
    try {
      setDirectoryLoading(true);
      setContactsPermissionDenied(false);

      // Önce daha önce kaydedilmiş AyTalk kişilerini göster. Telefon rehberi
      // izni kapalı olsa bile bunlar artık kaybolmaz.
      const savedBeforeScan = await loadSavedLiveBridgeContacts(directoryPhone);

      if (Platform.OS === "android") {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
          {
            title: "LiveBridge Kişiler",
            message:
              "Rehberindeki hangi kişilerin LiveBridge kullandığını göstermek için kişi izni gerekiyor.",
            buttonPositive: "İzin Ver",
            buttonNegative: "Şimdi Değil",
          },
        );
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          setContactsPermissionDenied(true);
          setDirectoryUsers(savedBeforeScan);
          return;
        }
      }

      const contacts = await Contacts.getAll();
      const raw = contacts.flatMap(contact =>
        (contact.phoneNumbers || []).map(phoneNumber => ({
          phone: normalizeLiveBridgePhone(phoneNumber.number),
          keys: liveBridgePhoneKeys(phoneNumber.number),
          name:
            `${contact.givenName || ""} ${contact.familyName || ""}`.trim() ||
            contact.displayName ||
            "Kişi",
        })),
      );
      const deduped = Array.from(
        new Map(
          raw
            .filter(item => item.phone.length >= 7)
            .map(item => [item.phone, item]),
        ).values(),
      );

      const data = await fetchJson<{users?: LiveBridgeDirectoryUser[]}>(
        "/livebridge/contacts/match",
        {
          method: "POST",
          body: JSON.stringify({
            ownerPhone: directoryPhone,
            contacts: deduped.slice(0, 3000),
          }),
        },
        15000,
      );

      // Sunucu bu noktadan sonra sadece o an eşleşenleri değil, sahibin daha
      // önce kaydedilmiş AyTalk kişilerini de döndürür.
      const matched = Array.isArray(data?.users) ? data.users : [];
      const merged = mergeLiveBridgeUsers(savedBeforeScan, matched);
      setDirectoryUsers(merged);
      await AsyncStorage.setItem(
        liveBridgeContactsStorageKey(directoryPhone),
        JSON.stringify(merged),
      );
    } catch (error) {
      // Ağ hatasında mevcut kişileri silme. Eski kod burada listeyi boşaltabiliyordu.
      Alert.alert(
        "Kişiler yüklenemedi",
        error instanceof Error ? error.message : "Telefon rehberi okunamadı.",
      );
    } finally {
      setDirectoryLoading(false);
    }
  }, [
    directoryPhone,
    directoryProfileReady,
    loadSavedLiveBridgeContacts,
  ]);

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
          void loadSavedLiveBridgeContacts(phone);
          setTimeout(() => void registerDirectoryProfile(phone), 100);
        }
      } catch {}
    };
    void load();
    return () => { cancelled = true; };
  }, [loadSavedLiveBridgeContacts, registerDirectoryProfile, visible]);

  useEffect(() => {
    // FCM token zaman içinde değişebilir. Değiştiğinde aynı LiveBridge profiline
    // sessizce yeniden kaydederek kapalı uygulama aramalarını canlı tut.
    const unsubscribe = messaging().onTokenRefresh(() => {
      if (directoryProfileReady && directoryPhone) {
        void registerDirectoryProfile(directoryPhone);
      }
    });
    return unsubscribe;
  }, [directoryPhone, directoryProfileReady, registerDirectoryProfile]);

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
        await fetchJson(
          "/livebridge/presence",
          {
            method: "POST",
            body: JSON.stringify({
              phone: directoryPhone,
              phoneKeys: liveBridgePhoneKeys(directoryPhone),
              name: name.trim() || "LiveBridge Kullanıcısı",
              language: sourceCallLanguage.name,
              gender: voiceGender,
            }),
          },
          8000,
        );
      } catch {}
    };
    void heartbeat();
    const timer = setInterval(() => void heartbeat(), 15000);
    return () => clearInterval(timer);
  }, [directoryPhone, directoryProfileReady, name, sourceCallLanguage.name, visible]);

  useEffect(() => {
    if (!visible || !directoryProfileReady || !directoryPhone || credentials || outgoingCall) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchJson<{call?: LiveBridgeIncomingCall | null}>(
          `/livebridge/call/incoming?phone=${encodeURIComponent(directoryPhone)}`,
          {method: "GET"},
          8000,
        );
        if (!cancelled) setIncomingCall(data?.call || null);
      } catch {}
    };
    void poll();
    const timer = setInterval(() => void poll(), 1800);
    return () => { cancelled = true; clearInterval(timer); };
  }, [credentials, directoryPhone, directoryProfileReady, outgoingCall, visible]);

  useEffect(() => {
    if (incomingCall && !credentials) {
      startLocalRingSound("incoming");
    } else {
      stopLocalRingSound("incoming");
    }
    return () => stopLocalRingSound("incoming");
  }, [
    credentials,
    incomingCall?.id,
    startLocalRingSound,
    stopLocalRingSound,
  ]);

  useEffect(() => {
    if (outgoingCall?.status === "ringing" && !credentials) {
      startLocalRingSound("outgoing");
    } else {
      stopLocalRingSound("outgoing");
    }
    return () => stopLocalRingSound("outgoing");
  }, [
    credentials,
    outgoingCall?.id,
    outgoingCall?.status,
    startLocalRingSound,
    stopLocalRingSound,
  ]);

  useEffect(() => {
    return () => {
      stopLocalRingSound("incoming");
      stopLocalRingSound("outgoing");
    };
  }, [stopLocalRingSound]);

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
    // Arama/ringback sesi yalnız arama ekranında kalır; görüşmeye geçmeden
    // önce iki olası zil de kesin olarak kapatılır.
    stopLocalRingSound("incoming");
    stopLocalRingSound("outgoing");

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
      const result = await getLiveKitCredentials({
        roomName: cleanRoom,
        participantIdentity,
        participantName: cleanName,
      });
      if (mode !== "chat") {
        await AudioSession.startAudioSession();
        if (AyAudioRoute) {
          await AyAudioRoute.setSpeakerEnabled(true);
        }
      }
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
    setActivePeerPhone(user.phone);
    setActivePeerName(user.name);

    // Yerelde kayıtlı görünmek, Render/Postgres tarafında kaydın hâlâ var
    // olduğu anlamına gelmez. Her direkt aramadan önce profil + FCM tokenı
    // sunucuda kesinleştirilir; böylece iki yönlü kişi keşfi bozulmaz.
    const profileReady = await registerDirectoryProfile(directoryPhone);
    if (!profileReady) return;
    if (mode === "video" && !DEMO_VIP_VIDEO_UNLOCKED) {
      Alert.alert("LiveBridge VIP", "Görüntülü LiveBridge görüşmesi VIP üyeliğe dahildir.");
      return;
    }
    try {
      const data = await fetchJson<{call: LiveBridgeIncomingCall & {calleeGender?: "male" | "female"; calleeLanguage?: string}}>(
        "/livebridge/call/start",
        {
          method: "POST",
          body: JSON.stringify({
            callerPhone: directoryPhone,
            callerName: name.trim() || "LiveBridge Kullanıcısı",
            calleePhone: user.phone,
            mode,
          }),
        },
        10000,
      );
      setActiveRemoteVoiceGender(data.call.calleeGender === "male" ? "male" : "female");
      setOutgoingCall({
        id: data.call.id,
        roomName: data.call.roomName,
        calleePhone: user.phone,
        calleeName: user.name,
        calleeGender: data.call.calleeGender === "male" ? "male" : "female",
        calleeLanguage: data.call.calleeLanguage || user.language,
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
    if (accepted) {
      setActivePeerPhone(current.callerPhone);
      setActivePeerName(current.callerName);
    }
    setIncomingCall(null);
    void notifee.cancelNotification(current.id).catch(() => undefined);
    try {
      await fetchJson(
        "/livebridge/call/respond",
        {
          method: "POST",
          body: JSON.stringify({
            callId: current.id,
            calleePhone: directoryPhone,
            accepted,
          }),
        },
        10000,
      );
      if (accepted) {
        setActiveRemoteVoiceGender(current.callerGender === "male" ? "male" : "female");
        await connectToRoom(current.roomName, current.mode);
      }
    } catch (error) {
      Alert.alert("Gelen arama", error instanceof Error ? error.message : "Arama yanıtlanamadı.");
    }
  };


  useEffect(() => {
    if (!outgoingCall || credentials) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchJson<{call?: LiveBridgeOutgoingCall}>(
          `/livebridge/call/status/${encodeURIComponent(outgoingCall.id)}`,
          {method: "GET"},
          8000,
        );
        if (cancelled) return;
        const status = data?.call?.status;
        if (status === "accepted") {
          const accepted = outgoingCall;
          setActivePeerPhone(accepted.calleePhone);
          setActivePeerName(accepted.calleeName);
          setOutgoingCall(null);
          stopLocalRingSound("outgoing");
          void connectToRoom(accepted.roomName, accepted.mode);
        } else if (status === "rejected" || status === "expired") {
          setOutgoingCall(null);
          Alert.alert(status === "rejected" ? "Arama reddedildi" : "Arama cevaplanmadı",
            `${outgoingCall.calleeName} görüşmeye katılmadı.`);
        }
      } catch {}
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
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
              voiceIsolation: true,
              autoGainControl: false,
              channelCount: 1,
            },
            publishDefaults: {
              audioPreset: AudioPresets.speech,
              dtx: true,
              red: true,
              forceStereo: false,
              stopMicTrackOnMute: false,
            },
          }}
          onConnected={() => {
            stopLocalRingSound("incoming");
            stopLocalRingSound("outgoing");
            setConnectionStatus("connected");
            setError("");
          }}
          onError={roomError => {
            const message =
              roomError instanceof Error
                ? roomError.message
                : "LiveKit bağlantı hatası.";
            setError(message);
            setConnectionStatus("idle");
            setCredentials(null);
            void AudioSession.stopAudioSession();
            Alert.alert("Görüşme bağlantı hatası", message);
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
            setActivePeerPhone("");
            setActivePeerName("");
            void AudioSession.stopAudioSession();
          }}>
          <RoomView
            sourceLanguage={sourceCallLanguage}
            targetLanguage={targetCallLanguage}
            participantName={name.trim() || "LiveBridge Kullanıcısı"}
            callMode={activeCallMode}
            bridgeDistance={activeBridgeDistance}
            remoteVoiceGender={voiceGender}
            ownerPhone={directoryPhone}
            peerPhone={activePeerPhone}
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
              stopLocalRingSound("incoming");
              stopLocalRingSound("outgoing");
              setConnectionStatus("idle");
              setCredentials(null);
              setActivePeerPhone("");
              setActivePeerName("");
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
            {directoryProfileReady ? (
              <>
                <View style={styles.liveBridgeHubIntro}>
                  <Text style={styles.liveBridgeHubIntroTitle}>LiveBridge</Text>
                  <Text style={styles.liveBridgeHubIntroText}>
                    Sohbet · Sesli arama · Görüntülü arama · Canlı çeviri
                  </Text>
                </View>
                <View style={styles.liveBridgeTopMenu}>
                {([
                  ["chats", "Sohbetler"],
                  ["contacts", "Kişiler"],
                  ["invites", "Davetler"],
                ] as const).map(([tab, label]) => {
                  const selected = liveBridgeHomeTab === tab;
                  return (
                    <TouchableOpacity
                      key={tab}
                      style={[
                        styles.liveBridgeTopMenuButton,
                        selected && styles.liveBridgeTopMenuActive,
                      ]}
                      onPress={() => {
                        setLiveBridgeHomeTab(tab);
                        if (tab === "contacts") void syncLiveBridgeContacts();
                        if (tab === "chats") void loadRecentConversations();
                      }}>
                      <Text
                        style={[
                          styles.liveBridgeTopMenuText,
                          selected && styles.liveBridgeTopMenuTextActive,
                        ]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                </View>
              </>
            ) : null}

            {!directoryProfileReady ? (
              <View style={styles.directorySetupCard}>
                <Text style={styles.directorySetupEyebrow}>LIVEBRIDGE KİŞİLER</Text>
                <Text style={styles.directorySetupTitle}>Rehberindeki LiveBridge kullanıcılarını bul</Text>
                <Text style={styles.directorySetupText}>
                  Numaranı ülke koduyla kaydet. Bu cihaz bir LiveBridge numarasına bağlanır; rastgele numaralarla kişilere doğrudan arama açılamaz.
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
            ) : liveBridgeHomeTab === "contacts" ? (
              <>
                <View style={styles.directoryHeaderRow}>
                  <View>
                    <Text style={styles.directoryTitle}>Kişiler</Text>
                    <Text style={styles.directorySubtitle}>
                      {contactsPermissionDenied
                        ? "Kaydedilmiş AyTalk kişilerin · rehber izni kapalı"
                        : "Kalıcı AyTalk kişilerin"}
                    </Text>
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

                {directoryUsers.length > 0 ? (
                  <View style={styles.directoryListCard}>
                    {directoryUsers.map(user => (
                      <TouchableOpacity
                        key={user.phone}
                        activeOpacity={0.88}
                        style={styles.directoryUserRow}
                        onPress={() => void openDirectoryChat(user)}>
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

                        <View style={styles.directoryQuickActions}>
                          <TouchableOpacity
                            style={styles.directoryQuickAction}
                            onPress={event => {
                              event.stopPropagation();
                              void openDirectoryChat(user);
                            }}>
                            <CallControlIcon name="message" size={18} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.directoryQuickAction}
                            onPress={event => {
                              event.stopPropagation();
                              void startDirectCall(user, "audio");
                            }}>
                            <CallControlIcon name="speaker" size={18} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.directoryQuickAction}
                            onPress={event => {
                              event.stopPropagation();
                              void startDirectCall(user, "video");
                            }}>
                            <CallControlIcon name="camera" size={18} />
                          </TouchableOpacity>
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
            ) : null}

            {directoryProfileReady && liveBridgeHomeTab === "chats" ? (
              <View style={styles.recentSection}>
                <View style={styles.directoryHeaderRow}><View><Text style={styles.directoryTitle}>
                  Sohbetler
                </Text>
                <Text style={styles.directorySubtitle}>
                  Kalıcı mesajlar · çeviriler · dosyalar
                </Text></View>
                <TouchableOpacity style={styles.directorySyncButton} onPress={()=>void loadRecentConversations()}>
                {recentLoading?<ActivityIndicator size="small" color="#4BC6FF"/>:<CallControlIcon name="loading" size={22}/>}</TouchableOpacity></View>
                {recentConversations.length?(
                  <View style={styles.directoryListCard}>{recentConversations.slice(0,8).map(item=>(
                    <TouchableOpacity key={item.peerPhone} style={styles.directoryUserRow} onPress={() => void openConversationHistory(item)}>
                      <View style={styles.directoryAvatar}><Text style={styles.directoryAvatarText}>{(item.peerName||"?").slice(0,1).toUpperCase()}</Text></View>
                      <View style={styles.directoryUserInfo}>
                        <Text style={styles.directoryUserName}>{item.peerName}</Text>
                        <Text style={styles.directoryUserPresence} numberOfLines={1}>{item.lastText}</Text>
                      </View>
                      <View style={styles.directoryQuickActions}>
                        <TouchableOpacity
                          style={styles.directoryQuickAction}
                          onPress={event => {
                            event.stopPropagation();
                            void startDirectCall(
                              {
                                phone:item.peerPhone,
                                name:item.peerName,
                                online:Boolean(item.peerOnline),
                                lastSeen:item.updatedAt,
                              },
                              "audio",
                            );
                          }}>
                          <CallControlIcon name="speaker" size={18} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.directoryQuickAction}
                          onPress={event => {
                            event.stopPropagation();
                            void startDirectCall(
                              {
                                phone:item.peerPhone,
                                name:item.peerName,
                                online:Boolean(item.peerOnline),
                                lastSeen:item.updatedAt,
                              },
                              "video",
                            );
                          }}>
                          <CallControlIcon name="camera" size={18} />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>))}</View>
                ):<View style={styles.directoryEmptyCard}><Text style={styles.directoryEmptyTitle}>Henüz görüşme yok</Text>
                <Text style={styles.directoryEmptyText}>İlk çeviri veya dosya paylaşımından sonra burada görünecek.</Text></View>}
              </View>
            ):null}

            {directoryProfileReady && liveBridgeHomeTab === "invites" ? (
              <>
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

              </>
            ) : null}

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
        visible={historyPeer !== null}
        animationType="slide"
        onRequestClose={() => setHistoryPeer(null)}>
        <SafeAreaViewSafe style={styles.chatScreenSafe}>
          <View style={styles.chatScreenHeader}>
            <TouchableOpacity
              style={styles.chatHeaderBack}
              onPress={() => setHistoryPeer(null)}>
              <Text style={styles.chatHeaderBackText}>‹</Text>
            </TouchableOpacity>

            <View style={styles.chatHeaderAvatar}>
              <Text style={styles.chatHeaderAvatarText}>
                {(historyPeer?.peerName || "?").slice(0, 1).toUpperCase()}
              </Text>
            </View>

            <View style={styles.chatHeaderIdentity}>
              <Text style={styles.chatHeaderName} numberOfLines={1}>
                {historyPeer?.peerName || "LiveBridge"}
              </Text>
              <Text style={styles.chatHeaderPresence}>
                {historyPeer?.peerOnline ? "Çevrimiçi" : "LiveBridge sohbeti"}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.chatHeaderAction}
              disabled={!historyPeerAsDirectoryUser}
              onPress={() => {
                if (!historyPeerAsDirectoryUser) return;
                void startDirectCall(historyPeerAsDirectoryUser, "audio");
              }}>
              <CallControlIcon name="speaker" size={24} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.chatHeaderAction}
              disabled={!historyPeerAsDirectoryUser}
              onPress={() => {
                if (!historyPeerAsDirectoryUser) return;
                void startDirectCall(historyPeerAsDirectoryUser, "video");
              }}>
              <CallControlIcon name="camera" size={24} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.chatHeaderAction}
              onPress={() =>
                historyPeerAsDirectoryUser &&
                setSelectedDirectoryUser(historyPeerAsDirectoryUser)
              }>
              <Text style={styles.chatHeaderMore}>⋮</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.chatScreenBody}>
            {historyLoading ? (
              <View style={styles.chatScreenLoading}>
                <ActivityIndicator size="large" color="#4BC6FF" />
              </View>
            ) : (
              <ScrollView
                style={styles.chatHistoryScroll}
                contentContainerStyle={styles.chatHistoryContent}>
                {historyMessages.map(message => {
                  const mine = message.senderPhone === directoryPhone;
                  return (
                    <View
                      key={message.id}
                      style={[
                        styles.chatHistoryBubble,
                        mine
                          ? styles.chatHistoryBubbleMine
                          : styles.chatHistoryBubbleRemote,
                      ]}>
                      {message.kind === "file" ? (
                        <>
                          {message.mimeType?.startsWith("image/") && message.url ? (
                            <Image
                              source={{uri: message.url}}
                              style={styles.chatMessageImage}
                              resizeMode="cover"
                            />
                          ) : null}
                          <Text style={styles.chatHistoryFile}>
                            📎 {message.fileName || "Dosya"}
                          </Text>
                          <Text style={styles.chatHistoryMeta}>
                            {message.mimeType || "Dosya"} ·{" "}
                            {formatBytes(Number(message.fileSize || 0))}
                          </Text>
                          {message.url ? (
                            <TouchableOpacity
                              onPress={() =>
                                void RNShare.open({
                                  url: message.url,
                                  type: message.mimeType || undefined,
                                  title: message.fileName || "AyTalk dosyası",
                                  failOnCancel: false,
                                })
                              }>
                              <Text style={styles.chatHistoryOpen}>
                                Aç / Paylaş
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </>
                      ) : (
                        <>
                          {message.originalText &&
                          message.translatedText &&
                          message.originalText !== message.translatedText ? (
                            <Text style={styles.chatHistoryOriginal}>
                              {message.originalText}
                            </Text>
                          ) : null}
                          <Text style={styles.chatHistoryTranslated}>
                            {message.translatedText || message.originalText}
                          </Text>
                        </>
                      )}

                      <Text style={styles.chatMessageTime}>
                        {new Date(message.createdAt).toLocaleTimeString("tr-TR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                    </View>
                  );
                })}

                {!historyLoading && historyMessages.length === 0 ? (
                  <View style={styles.chatWelcomeCard}>
                    <Text style={styles.chatWelcomeTitle}>
                      {historyPeer?.peerName || "LiveBridge"} ile sohbet
                    </Text>
                    <Text style={styles.chatWelcomeText}>
                      Mesajlar, görüşmede yapılan çeviriler ve paylaşılan dosyalar burada kalır.
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>

          <View style={styles.chatComposer}>
            <TouchableOpacity
              style={styles.chatComposerAttach}
              disabled={chatSending}
              onPress={openChatAttachmentMenu}>
              <Text style={styles.chatComposerAttachText}>＋</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.chatComposerInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Mesaj"
              placeholderTextColor="#6F8AA8"
              multiline
              maxLength={5000}
            />

            <TouchableOpacity
              style={[
                styles.chatComposerSend,
                (!chatInput.trim() || chatSending) &&
                  styles.chatComposerSendDisabled,
              ]}
              disabled={!chatInput.trim() || chatSending}
              onPress={() => void sendPersistentChatText()}>
              {chatSending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.chatComposerSendText}>➤</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaViewSafe>
      </Modal>

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
  chatScreenSafe: {
    flex: 1,
    backgroundColor: "#061326",
  },
  chatScreenHeader: {
    minHeight: 62,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0A1D35",
    borderBottomWidth: 1,
    borderBottomColor: "#173A60",
  },
  chatHeaderBack: {
    width: 34,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  chatHeaderBackText: {
    color: "#FFFFFF",
    fontSize: 38,
    lineHeight: 40,
    fontWeight: "300",
  },
  chatHeaderAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#163D67",
  },
  chatHeaderAvatarText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  chatHeaderIdentity: {
    flex: 1,
    minWidth: 0,
  },
  chatHeaderName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  chatHeaderPresence: {
    color: "#86A6C8",
    fontSize: 10,
    marginTop: 2,
  },
  chatHeaderAction: {
    width: 38,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  chatHeaderMore: {
    color: "#FFFFFF",
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "800",
  },
  chatScreenBody: {
    flex: 1,
    backgroundColor: "#07172A",
  },
  chatScreenLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chatHistoryContent: {
    padding: 14,
    paddingBottom: 24,
  },
  chatMessageImage: {
    width: 210,
    height: 160,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: "#0B213D",
  },
  chatMessageTime: {
    color: "#7893AF",
    fontSize: 9,
    alignSelf: "flex-end",
    marginTop: 5,
  },
  chatWelcomeCard: {
    marginTop: 30,
    alignSelf: "center",
    maxWidth: 300,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "#0C213B",
    borderWidth: 1,
    borderColor: "#173E67",
  },
  chatWelcomeTitle: {
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 15,
  },
  chatWelcomeText: {
    color: "#86A6C8",
    textAlign: "center",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 6,
  },
  chatComposer: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: "#091A30",
    borderTopWidth: 1,
    borderTopColor: "#173A60",
  },
  chatComposerAttach: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#14375E",
  },
  chatComposerAttachText: {
    color: "#FFFFFF",
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "400",
  },
  chatComposerInput: {
    flex: 1,
    maxHeight: 110,
    minHeight: 42,
    borderRadius: 21,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "#102640",
    color: "#FFFFFF",
    fontSize: 14,
  },
  chatComposerSend: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1687C9",
  },
  chatComposerSendDisabled: {
    opacity: 0.4,
  },
  chatComposerSendText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  chatHistoryCard: {
    width: "92%",
    maxHeight: "82%",
    borderRadius: 24,
    padding: 16,
    backgroundColor: "#07172C",
    borderWidth: 1,
    borderColor: "#1C4A78",
  },
  chatHistoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  chatHistoryTitle: {color: "#FFFFFF", fontSize: 20, fontWeight: "900"},
  chatHistorySubtitle: {color: "#7897BA", fontSize: 11, marginTop: 2},
  chatHistoryClose: {color: "#FFFFFF", fontSize: 22, padding: 6},
  chatHistoryScroll: {maxHeight: 520},
  chatHistoryBubble: {
    maxWidth: "88%",
    padding: 12,
    borderRadius: 16,
    marginBottom: 9,
  },
  chatHistoryBubbleMine: {alignSelf: "flex-end", backgroundColor: "#123B68"},
  chatHistoryBubbleRemote: {alignSelf: "flex-start", backgroundColor: "#10233F"},
  chatHistoryOriginal: {color: "#9AB5D3", fontSize: 12, marginBottom: 4},
  chatHistoryTranslated: {color: "#FFFFFF", fontSize: 14, lineHeight: 20},
  chatHistoryFile: {color: "#FFFFFF", fontSize: 14, fontWeight: "800"},
  chatHistoryMeta: {color: "#89A7C8", fontSize: 11, marginTop: 4},
  chatHistoryOpen: {color: "#4BC6FF", fontSize: 12, fontWeight: "900", marginTop: 8},
  chatHistoryEmpty: {color: "#7897BA", textAlign: "center", paddingVertical: 24},
  subtitleVoiceGenderButton: {
    paddingHorizontal: 9,
    minHeight: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#102D4D",
    marginLeft: "auto",
    marginRight: 6,
  },
  subtitleVoiceGenderText: {color: "#FFFFFF", fontSize: 10, fontWeight: "800"},
  moreMenuPdfIcon: {color: "#FFFFFF", fontSize: 10, fontWeight: "900"},
  moreMenuVoiceSection: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  moreMenuVoiceRow: {flexDirection: "row", gap: 10, marginTop: 8},
  moreMenuVoiceButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  moreMenuVoiceButtonActive: {
    backgroundColor: "#123B68",
    borderColor: "#4BC6FF",
  },
  moreMenuVoiceStatus:{color:"#4BC6FF",fontSize:10,fontWeight:"900",marginTop:3,marginBottom:7},
  moreMenuVoiceText: {color: "#FFFFFF", fontSize: 12, fontWeight: "800"},
  liveBridgeHubIntro:{marginBottom:12,paddingHorizontal:2},
  liveBridgeHubIntroTitle:{color:"#FFFFFF",fontSize:24,fontWeight:"900",letterSpacing:-0.4},
  liveBridgeHubIntroText:{color:"#7897B8",fontSize:10,marginTop:3},
  liveBridgeTopMenu:{flexDirection:"row",gap:8,marginBottom:16,padding:4,borderRadius:18,backgroundColor:"#08162B",borderWidth:1,borderColor:"#16345A"},
  liveBridgeTopMenuButton:{flex:1,minHeight:42,borderRadius:14,alignItems:"center",justifyContent:"center"},
  liveBridgeTopMenuActive:{flex:1,minHeight:42,borderRadius:14,alignItems:"center",justifyContent:"center",backgroundColor:"#123B68"},
  liveBridgeTopMenuText:{color:"#7892B1",fontWeight:"800",fontSize:12},
  liveBridgeTopMenuTextActive:{color:"#FFFFFF",fontWeight:"900",fontSize:12},
  recentSection:{marginTop:18,marginBottom:12},
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
  directoryQuickActions:{flexDirection:"row",alignItems:"center",gap:5,marginLeft:8},
  directoryQuickAction:{width:32,height:32,borderRadius:16,alignItems:"center",justifyContent:"center",backgroundColor:"#12385C"},
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
  imageViewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageViewerImage: {width: "100%", height: "82%"},
  imageViewerClose: {
    position: "absolute", top: 48, right: 20, zIndex: 4,
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(15,31,55,0.9)",
  },
  imageViewerCloseText: {color: "#FFFFFF", fontSize: 30, fontWeight: "700"},
  imageViewerShareButton: {
    position: "absolute", bottom: 34,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 18,
    backgroundColor: "#147AF3",
  },
  imageViewerShareText: {color: "#FFFFFF", fontSize: 13, fontWeight: "800"},
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
  attachmentImagePreview: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: "#10233F",
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
    minWidth: 88,
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
