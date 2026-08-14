import React from "react";
import Svg, {Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop} from "react-native-svg";

export type CallControlIconName =
  | "microphone" | "microphoneOff" | "camera" | "cameraOff" | "flip"
  | "translate" | "stop" | "loading" | "speaker" | "speakerOff"
  | "hangup" | "subtitles" | "more" | "message" | "videoMode";

export default function CallControlIcon({
  name,
  size = 24,
  danger = false,
}: {
  name: CallControlIconName;
  size?: number;
  danger?: boolean;
}) {
  const p = danger ? "#FF6675" : "#35D8FF";
  const s = danger ? "#FF304D" : "#6B62FF";

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="cg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={p} />
          <Stop offset="1" stopColor={s} />
        </LinearGradient>
      </Defs>

      {name === "microphone" ? <G fill="none" stroke="url(#cg)" strokeWidth="7" strokeLinecap="round">
        <Rect x="37" y="13" width="26" height="46" rx="13"/><Path d="M24 48c0 17 11 28 26 28s26-11 26-28"/>
        <Line x1="50" y1="76" x2="50" y2="89"/><Line x1="36" y1="89" x2="64" y2="89"/>
      </G> : null}

      {name === "microphoneOff" ? <G fill="none" stroke="url(#cg)" strokeWidth="7" strokeLinecap="round">
        <Rect x="37" y="13" width="26" height="46" rx="13"/><Path d="M24 48c0 17 11 28 26 28 7 0 13-2 18-6"/>
        <Line x1="50" y1="76" x2="50" y2="89"/><Line x1="36" y1="89" x2="64" y2="89"/>
        <Line x1="18" y1="18" x2="82" y2="82" stroke="#FF6675"/>
      </G> : null}

      {name === "camera" ? <G fill="none" stroke="url(#cg)" strokeWidth="7" strokeLinejoin="round">
        <Rect x="12" y="27" width="54" height="47" rx="12"/><Path d="M66 42l21-13v43L66 59z"/>
      </G> : null}

      {name === "cameraOff" ? <G fill="none" stroke="url(#cg)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round">
        <Rect x="12" y="27" width="54" height="47" rx="12"/><Path d="M66 42l21-13v43L66 59z"/>
        <Line x1="17" y1="17" x2="83" y2="83" stroke="#FF6675"/>
      </G> : null}

      {name === "flip" ? <G fill="none" stroke="url(#cg)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <Path d="M24 37c7-15 24-22 40-15 6 2 11 6 15 11"/><Path d="M76 22l4 13-14 1"/>
        <Path d="M76 63c-7 15-24 22-40 15-6-2-11-6-15-11"/><Path d="M24 78l-4-13 14-1"/>
        <Circle cx="50" cy="50" r="12" strokeWidth="5"/>
      </G> : null}

      {name === "translate" ? <G fill="none" stroke="url(#cg)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <Path d="M9 19h43a10 10 0 0 1 10 10v20a10 10 0 0 1-10 10H31L19 70V59H9z"/>
        <Path d="M47 46h42v35H70L59 90V81H47"/><Path d="M21 39h7v-9h7v18h7V25h7v23"/>
        <Path d="M59 62h18M68 53v18M59 74c7-2 13-7 17-14"/>
      </G> : null}

      {name === "stop" ? <G><Circle cx="50" cy="50" r="38" fill="none" stroke="#FFB347" strokeWidth="6"/>
        <Rect x="34" y="34" width="32" height="32" rx="7" fill="#FFB347"/></G> : null}

      {name === "loading" ? <G fill="none" stroke="url(#cg)" strokeWidth="7" strokeLinecap="round">
        <Path d="M50 14a36 36 0 1 1-31 18"/><Path d="M14 18l6 17 17-6"/>
      </G> : null}

      {name === "speaker" ? <G fill="none" stroke="url(#cg)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <Path d="M14 42h18l22-18v52L32 58H14z"/><Path d="M66 37c7 7 7 19 0 26"/><Path d="M76 27c13 13 13 33 0 46"/>
      </G> : null}

      {name === "speakerOff" ? <G fill="none" stroke="url(#cg)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <Path d="M14 42h18l22-18v52L32 58H14z"/><Line x1="66" y1="38" x2="87" y2="65" stroke="#FF6675"/>
        <Line x1="87" y1="38" x2="66" y2="65" stroke="#FF6675"/>
      </G> : null}

      {name === "hangup" ? <G fill="none" stroke="#FFF" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
        <Path d="M20 61c18-15 42-15 60 0"/><Path d="M20 61l8 17 15-8-3-15"/><Path d="M80 61l-8 17-15-8 3-15"/>
      </G> : null}

      {name === "subtitles" ? <G fill="none" stroke="url(#cg)" strokeWidth="5" strokeLinecap="round">
        <Rect x="12" y="22" width="76" height="56" rx="13"/><Line x1="24" y1="48" x2="45" y2="48"/>
        <Line x1="55" y1="48" x2="76" y2="48"/><Line x1="24" y1="62" x2="43" y2="62"/><Line x1="57" y1="62" x2="76" y2="62"/>
      </G> : null}

      {name === "more" ? <G fill="url(#cg)"><Circle cx="25" cy="50" r="7"/><Circle cx="50" cy="50" r="7"/><Circle cx="75" cy="50" r="7"/></G> : null}

      {name === "message" ? <G fill="none" stroke="url(#cg)" strokeWidth="6" strokeLinejoin="round">
        <Path d="M15 17h70v52H47L27 84V69H15z"/><Line x1="28" y1="37" x2="72" y2="37"/><Line x1="28" y1="51" x2="62" y2="51"/>
      </G> : null}

      {name === "videoMode" ? <G fill="none" stroke="url(#cg)" strokeWidth="6" strokeLinejoin="round">
        <Rect x="13" y="25" width="50" height="48" rx="11"/><Path d="M63 40l24-13v44L63 58z"/>
        <Line x1="19" y1="82" x2="81" y2="18" stroke="#FF6675"/>
      </G> : null}
    </Svg>
  );
}
