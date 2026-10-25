import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

export const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});

export const C = {
  ink: "#0f1412",
  inkSoft: "#1b231f",
  paper: "#f6f5f0",
  green: "#2f5d46",
  greenBright: "#4fb07a",
  ember: "#ff7a2f",
  emberHot: "#ffb347",
  fire: "#e0452b",
  muted: "#9aa39e",
};

export const ease = Easing.bezier(0.16, 1, 0.3, 1);

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

// Fades a whole scene in and out at its own edges.
export const SceneFade: React.FC<{
  children: React.ReactNode;
  inFrames?: number;
  outFrames?: number;
  style?: React.CSSProperties;
}> = ({ children, inFrames = 10, outFrames = 10, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        fontFamily,
        opacity: interpolate(
          frame,
          [0, inFrames, durationInFrames - outFrames, durationInFrames],
          [0, 1, 1, 0],
          clamp,
        ),
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

// Element that rises and fades in starting at `delay` frames.
export const Rise: React.FC<{
  delay?: number;
  distance?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, distance = 40, children, style }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        opacity: interpolate(frame, [delay, delay + 14], [0, 1], clamp),
        translate: interpolate(
          frame,
          [delay, delay + 22],
          [`0px ${distance}px`, "0px 0px"],
          { ...clamp, easing: ease },
        ),
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = C.ember,
}) => (
  <div
    style={{
      fontSize: 30,
      fontWeight: 700,
      letterSpacing: 6,
      textTransform: "uppercase",
      color,
    }}
  >
    {children}
  </div>
);

// Deterministic rising ember particles.
export const Embers: React.FC<{ count?: number; seed?: string; opacity?: number }> = ({
  count = 60,
  seed = "embers",
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      {new Array(count).fill(0).map((_, i) => {
        const speed = 1.2 + random(`${seed}-s-${i}`) * 3.2;
        const size = 3 + random(`${seed}-z-${i}`) * 7;
        const x0 = random(`${seed}-x-${i}`) * width;
        const y0 = random(`${seed}-y-${i}`) * height;
        const y = (((y0 - frame * speed) % (height + 40)) + height + 40) % (height + 40);
        const sway = Math.sin(frame / (18 + i) + i) * 26;
        const flicker = 0.45 + 0.55 * Math.abs(Math.sin(frame / (5 + (i % 7)) + i));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x0 + sway,
              top: y - 20,
              width: size,
              height: size,
              borderRadius: "50%",
              background: i % 3 === 0 ? C.emberHot : C.ember,
              boxShadow: `0 0 ${size * 3}px ${C.ember}`,
              opacity: flicker,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// A light browser-window frame for app screenshots.
export const AppFrame: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      borderRadius: 22,
      overflow: "hidden",
      background: "#fff",
      boxShadow: "0 40px 120px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)",
      ...style,
    }}
  >
    <div
      style={{
        height: 40,
        background: "#eceae3",
        display: "flex",
        alignItems: "center",
        gap: 10,
        paddingLeft: 18,
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />
      ))}
    </div>
    {children}
  </div>
);
