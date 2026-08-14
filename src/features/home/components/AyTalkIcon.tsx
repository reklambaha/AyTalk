import React from "react";
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";

export type AyTalkIconName =
  | "livebridge"
  | "translation"
  | "assistant"
  | "visual"
  | "conference"
  | "history"
  | "home"
  | "profile";

export default function AyTalkIcon({
  name,
  size = 64,
}: {
  name: AyTalkIconName;
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 100 100",
  } as const;

  const defs = (
    <Defs>
      <LinearGradient id="cyanBlue" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#26D5FF" />
        <Stop offset="0.55" stopColor="#168BFF" />
        <Stop offset="1" stopColor="#675BFF" />
      </LinearGradient>
      <LinearGradient id="violetCyan" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#8B5CFF" />
        <Stop offset="1" stopColor="#20D4FF" />
      </LinearGradient>
    </Defs>
  );

  if (name === "livebridge") {
    return (
      <Svg {...common}>
        {defs}
        <Circle cx="50" cy="50" r="27" fill="none" stroke="url(#cyanBlue)" strokeWidth="4" />
        <Path d="M23 50h54M50 23c-10 11-15 20-15 27s5 16 15 27M50 23c10 11 15 20 15 27s-5 16-15 27"
          fill="none" stroke="#42D7FF" strokeWidth="2.2" strokeLinecap="round" opacity="0.95" />
        <Path d="M16 36h20a7 7 0 0 1 7 7v9a7 7 0 0 1-7 7H27l-8 7v-7h-3a7 7 0 0 1-7-7v-9a7 7 0 0 1 7-7z"
          fill="#665CFF" stroke="#B2A8FF" strokeWidth="1.5" />
        <Path d="M64 39h20a7 7 0 0 1 7 7v9a7 7 0 0 1-7 7h-3v7l-8-7h-9a7 7 0 0 1-7-7v-9a7 7 0 0 1 7-7z"
          fill="#16C8E9" stroke="#9BF6FF" strokeWidth="1.5" />
        <Circle cx="20" cy="48" r="2.2" fill="#fff" />
        <Circle cx="27" cy="48" r="2.2" fill="#fff" />
        <Circle cx="34" cy="48" r="2.2" fill="#fff" />
        <Circle cx="66" cy="51" r="2.2" fill="#fff" />
        <Circle cx="73" cy="51" r="2.2" fill="#fff" />
        <Circle cx="80" cy="51" r="2.2" fill="#fff" />
      </Svg>
    );
  }

  if (name === "translation") {
    return (
      <Svg {...common}>
        {defs}
        <Path d="M12 25h39a11 11 0 0 1 11 11v13a11 11 0 0 1-11 11H34l-12 10v-10H12A11 11 0 0 1 1 49V36a11 11 0 0 1 11-11z"
          fill="none" stroke="url(#cyanBlue)" strokeWidth="4" />
        <Path d="M50 43h38a11 11 0 0 1 11 11v12a11 11 0 0 1-11 11H74L62 87V77H50a11 11 0 0 1-11-11V54"
          fill="none" stroke="#765FFF" strokeWidth="4" />
        <Path d="M15 44h5v-8h5v16h5V31h5v21h5V39h5v13h5"
          fill="none" stroke="#35DEFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M58 58h20M68 50v16M58 70c7-2 13-7 18-15"
          fill="none" stroke="#B6A7FF" strokeWidth="3" strokeLinecap="round" />
      </Svg>
    );
  }

  if (name === "assistant") {
    return (
      <Svg {...common}>
        {defs}
        <G fill="none" stroke="url(#violetCyan)" strokeWidth="3">
          <Path d="M50 8l26 15v30L50 68 24 53V23z" />
          <Path d="M50 20l16 9v18l-16 9-16-9V29z" />
          <Path d="M50 32l7 4v8l-7 4-7-4v-8z" />
        </G>
        <Circle cx="50" cy="40" r="7" fill="#35D8FF" />
        <Circle cx="50" cy="40" r="14" fill="none" stroke="#765FFF" strokeWidth="2" opacity="0.65" />
        <Circle cx="24" cy="23" r="3.5" fill="#5EE6FF" />
        <Circle cx="76" cy="23" r="3.5" fill="#7764FF" />
        <Circle cx="50" cy="68" r="3.5" fill="#30D9FF" />
      </Svg>
    );
  }

  if (name === "visual") {
    return (
      <Svg {...common}>
        {defs}
        <Path d="M22 25h15l5-7h17l5 7h14a10 10 0 0 1 10 10v35a10 10 0 0 1-10 10H22A10 10 0 0 1 12 70V35a10 10 0 0 1 10-10z"
          fill="none" stroke="url(#cyanBlue)" strokeWidth="4" />
        <Circle cx="50" cy="52" r="15" fill="none" stroke="#28CFFF" strokeWidth="4" />
        <Circle cx="50" cy="52" r="7" fill="#153B7B" stroke="#8A74FF" strokeWidth="2" />
        <Path d="M7 16v16M7 16h16M93 16v16M93 16H77M7 84V68M7 84h16M93 84V68M93 84H77"
          fill="none" stroke="#72E9FF" strokeWidth="3.5" strokeLinecap="round" />
        <Circle cx="78" cy="75" r="15" fill="#116CE8" stroke="#57E0FF" strokeWidth="2" />
        <Path d="M71 71h14M78 65v14M72 80c5-2 9-5 12-10"
          fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </Svg>
    );
  }

  if (name === "conference") {
    return (
      <Svg {...common}>
        {defs}
        <Circle cx="50" cy="56" r="26" fill="none" stroke="#1CCFFF" strokeWidth="3.5" />
        <Path d="M25 56h50M50 30c-9 10-14 18-14 26s5 16 14 26M50 30c9 10 14 18 14 26s-5 16-14 26"
          fill="none" stroke="#6C66FF" strokeWidth="2.2" opacity="0.9" />
        <Circle cx="50" cy="18" r="9" fill="#168BFF" stroke="#67E6FF" strokeWidth="2" />
        <Circle cx="25" cy="28" r="8" fill="#675BFF" stroke="#A394FF" strokeWidth="2" />
        <Circle cx="75" cy="28" r="8" fill="#16A9E8" stroke="#69E9FF" strokeWidth="2" />
        <Path d="M37 43c2-9 7-14 13-14s11 5 13 14M13 45c2-7 6-11 12-11s10 4 12 11M63 45c2-7 6-11 12-11s10 4 12 11"
          fill="none" stroke="url(#violetCyan)" strokeWidth="4" strokeLinecap="round" />
      </Svg>
    );
  }

  if (name === "history") {
    return (
      <Svg {...common}>
        {defs}
        <Circle cx="28" cy="36" r="16" fill="none" stroke="url(#cyanBlue)" strokeWidth="4" />
        <Path d="M28 26v11l8 5" fill="none" stroke="#64E4FF" strokeWidth="3" strokeLinecap="round" />
        <Rect x="45" y="20" width="38" height="57" rx="7" fill="none" stroke="#406DFF" strokeWidth="4" />
        <Path d="M54 34h20M54 44h20M54 54h15M18 72h64"
          fill="none" stroke="#6D67FF" strokeWidth="3" strokeLinecap="round" />
        <Circle cx="18" cy="72" r="3" fill="#54E1FF" />
        <Circle cx="38" cy="72" r="3" fill="#6B64FF" />
      </Svg>
    );
  }

  if (name === "home") {
    return (
      <Svg {...common}>
        {defs}
        <Path d="M17 48L50 20l33 28v31a7 7 0 0 1-7 7H24a7 7 0 0 1-7-7z"
          fill="none" stroke="url(#cyanBlue)" strokeWidth="5" strokeLinejoin="round" />
        <Path d="M40 86V59h20v27" fill="none" stroke="#38D8FF" strokeWidth="5" />
      </Svg>
    );
  }

  return (
    <Svg {...common}>
      {defs}
      <Circle cx="50" cy="34" r="16" fill="none" stroke="url(#cyanBlue)" strokeWidth="5" />
      <Path d="M22 84c3-20 13-30 28-30s25 10 28 30"
        fill="none" stroke="url(#violetCyan)" strokeWidth="5" strokeLinecap="round" />
    </Svg>
  );
}
