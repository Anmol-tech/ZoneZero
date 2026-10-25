import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Video } from "@remotion/media";
import { AppFrame, C, Embers, Kicker, Rise, SceneFade, ease } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* ---------- 1. WHY: embers, not flames ---------- */
export const WhyEmbers: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hazards = [
    { label: "A gutter full of needles", at: 5.3 },
    { label: "An open vent", at: 6.9 },
    { label: "A fence touching the wall", at: 8.0 },
  ];
  return (
    <SceneFade inFrames={1} style={{ backgroundColor: C.ink }}>
      <AbsoluteFill style={{ scale: interpolate(frame, [0, 320], [1.08, 1.18]) }}>
        <Video
          src={staticFile("clips/footage.mp4")}
          muted
          objectFit="cover"
          style={{ width: "100%", height: "100%" }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(15,20,18,0.94) 0%, rgba(15,20,18,0.75) 45%, rgba(60,20,5,0.35) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at 80% 110%, rgba(255,110,40,0.45), transparent 60%)",
          opacity: interpolate(frame, [0, 120], [0.2, 1], clamp),
        }}
      />
      <Embers count={70} seed="why" />
      <AbsoluteFill style={{ padding: "150px 140px", justifyContent: "center", color: C.paper }}>
        <Rise delay={4}>
          <Kicker>Why</Kicker>
        </Rise>
        <Rise delay={10}>
          <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.04, marginTop: 24, maxWidth: 1150 }}>
            Most homes aren't lost to the flames.
          </div>
        </Rise>
        <Rise delay={Math.round(2.9 * fps)}>
          <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.04, marginTop: 16, color: C.ember }}>
            They're lit by embers.
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 22, marginTop: 64, flexWrap: "wrap" }}>
          {hazards.map((h) => (
            <Rise key={h.label} delay={Math.round(h.at * fps)} distance={24}>
              <div
                style={{
                  fontSize: 40,
                  fontWeight: 600,
                  padding: "18px 30px",
                  borderRadius: 999,
                  background: "rgba(255,122,47,0.14)",
                  border: `2px solid ${C.ember}`,
                }}
              >
                {h.label}
              </div>
            </Rise>
          ))}
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 140, bottom: 70, fontSize: 26, color: C.muted }}>
        Source: IBHS wildfire ember research
      </div>
    </SceneFade>
  );
};

/* ---------- 2. WHY: the stakes ---------- */
export const WhyStakes: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <SceneFade style={{ backgroundColor: C.ink, color: C.paper }}>
      <Embers count={30} seed="stakes" opacity={0.5} />
      <AbsoluteFill style={{ padding: "0 140px", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 40 }}>
          {[
            { big: "Dropped", small: "Insurers are non-renewing homes in fire zones", at: 0.2 },
            { big: "Weeks", small: "to get a professional home assessment", at: 1.9 },
          ].map((s) => (
            <Rise key={s.big} delay={Math.round(s.at * fps)} style={{ flex: 1 }}>
              <div
                style={{
                  padding: "44px 48px",
                  borderRadius: 28,
                  background: C.inkSoft,
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ fontSize: 88, fontWeight: 800, color: C.ember }}>{s.big}</div>
                <div style={{ fontSize: 40, marginTop: 10, color: "#d7dad6", lineHeight: 1.3 }}>{s.small}</div>
              </div>
            </Rise>
          ))}
        </div>
        <div
          style={{
            marginTop: 80,
            fontSize: 104,
            fontWeight: 800,
            opacity: interpolate(frame, [3.8 * fps, 4.3 * fps], [0, 1], clamp),
            scale: interpolate(frame, [3.8 * fps, 4.6 * fps], [0.94, 1], { ...clamp, easing: ease }),
            transformOrigin: "left center",
          }}
        >
          Which fix actually matters?
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};

/* ---------- 3. WHAT: meet ZoneZero ---------- */
export const WhatIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const steps = ["Film your house", "See how it would catch fire", "Fix what matters"];
  return (
    <SceneFade style={{ backgroundColor: C.paper, color: C.ink }}>
      <AbsoluteFill style={{ padding: "0 0 0 140px", justifyContent: "center" }}>
        <Rise delay={0}>
          <Kicker color={C.green}>What</Kicker>
        </Rise>
        <Rise delay={4}>
          <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -4, marginTop: 10 }}>
            Zone<span style={{ color: C.ember }}>Zero</span>
          </div>
        </Rise>
        <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 22 }}>
          {steps.map((s, i) => (
            <Rise key={s} delay={Math.round((1.4 + i * 1.3) * fps)} distance={20}>
              <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 48, fontWeight: 600 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    background: i === 1 ? C.ember : C.green,
                    color: "#fff",
                    fontSize: 30,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {i + 1}
                </div>
                {s}
              </div>
            </Rise>
          ))}
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 170,
          width: 1180,
          translate: interpolate(frame, [0, 30], ["120px 60px", "0px 0px"], { ...clamp, easing: ease }),
          opacity: interpolate(frame, [0, 14], [0, 1], clamp),
          rotate: "-2deg",
        }}
      >
        <AppFrame>
          <Img src={staticFile("shots/app_burn.png")} style={{ width: "100%", display: "block" }} />
        </AppFrame>
      </div>
    </SceneFade>
  );
};

/* ---------- 4. HOW 1: watch & model ---------- */
export const HowModel: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tags = [
    { t: "0:02", label: "Gutters", x: 330, y: 120, at: 1.6 },
    { t: "0:07", label: "Plants & shrubs", x: 40, y: 330, at: 2.3 },
    { t: "0:05", label: "Patio furniture", x: 380, y: 470, at: 3.0 },
    { t: "0:15", label: "Wood fence", x: 560, y: 300, at: 3.6 },
  ];
  const renderIn = 4.6 * fps;
  return (
    <SceneFade style={{ backgroundColor: C.ink, color: C.paper }}>
      <div style={{ position: "absolute", left: 120, top: 90 }}>
        <Rise>
          <Kicker>How · 1 · Watch and model</Kicker>
        </Rise>
        <Rise delay={6}>
          <div style={{ fontSize: 64, fontWeight: 800, marginTop: 14 }}>
            Gemini 4 Argon reads your footage
          </div>
        </Rise>
      </div>
      {/* Real footage with hazard tags */}
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 300,
          width: 820,
          height: 620,
          borderRadius: 24,
          overflow: "hidden",
          boxShadow: "0 30px 90px rgba(0,0,0,0.5)",
        }}
      >
        <Video
          src={staticFile("clips/footage.mp4")}
          muted
          trimBefore={2 * fps}
          objectFit="cover"
          style={{ width: "100%", height: "100%" }}
        />
        {tags.map((g) => (
          <div
            key={g.label}
            style={{
              position: "absolute",
              left: g.x,
              top: g.y,
              opacity: interpolate(frame, [g.at * fps, g.at * fps + 8], [0, 1], clamp),
              scale: interpolate(frame, [g.at * fps, g.at * fps + 12], [0.6, 1], { ...clamp, easing: ease }),
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "rgba(15,20,18,0.85)",
              border: `2px solid ${C.ember}`,
              padding: "10px 18px",
              borderRadius: 14,
              whiteSpace: "nowrap",
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            <span style={{ color: C.ember, fontVariantNumeric: "tabular-nums" }}>{g.t}</span>
            {g.label}
          </div>
        ))}
        <div style={{ position: "absolute", left: 20, bottom: 18, fontSize: 24, color: "#e6e6e6" }}>
          Your footage
        </div>
      </div>
      {/* Arrow */}
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 580,
          fontSize: 70,
          color: C.ember,
          opacity: interpolate(frame, [renderIn - 10, renderIn], [0, 1], clamp),
        }}
      >
        →
      </div>
      {/* 3D model render */}
      <div
        style={{
          position: "absolute",
          left: 1060,
          top: 300,
          width: 740,
          height: 620,
          borderRadius: 24,
          overflow: "hidden",
          background: "#fff",
          boxShadow: "0 30px 90px rgba(0,0,0,0.5)",
          opacity: interpolate(frame, [renderIn, renderIn + 12], [0, 1], clamp),
          translate: interpolate(frame, [renderIn, renderIn + 24], ["60px 0px", "0px 0px"], { ...clamp, easing: ease }),
        }}
      >
        <Img
          src={staticFile("shots/app_original.png")}
          style={{
            position: "absolute",
            width: 1920 * 0.95,
            left: -349 * 0.95,
            top: -250 * 0.95,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 18,
            bottom: 18,
            fontSize: 26,
            fontWeight: 700,
            background: C.green,
            padding: "10px 18px",
            borderRadius: 12,
            opacity: interpolate(frame, [6.4 * fps, 6.8 * fps], [0, 1], clamp),
          }}
        >
          ✓ Matches the real footage
        </div>
        <div style={{ position: "absolute", left: 20, bottom: 18, fontSize: 24, color: C.ink, fontWeight: 600 }}>
          3D model it wrote
        </div>
      </div>
    </SceneFade>
  );
};

/* ---------- 5. HOW 2: burn it ---------- */
export const HowBurn: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chain = [
    { t: "0:30", label: "Shrub catches an ember", at: 1.4 },
    { t: "0:39", label: "Wood fence", at: 2.6 },
    { t: "0:41", label: "Neighbor's siding", at: 3.4 },
    { t: "1:00", label: "House ignites", at: 4.6, hot: true },
  ];
  return (
    <SceneFade style={{ backgroundColor: C.ink, color: C.paper }}>
      <div style={{ position: "absolute", left: 120, top: 90 }}>
        <Kicker>How · 2 · Burn it</Kicker>
        <div style={{ fontSize: 64, fontWeight: 800, marginTop: 14 }}>A simulated ember storm</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 290,
          width: 1000,
          height: 805,
          borderRadius: 24,
          overflow: "hidden",
          boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
        }}
      >
        <Video
          src={staticFile("clips/burn_before.mp4")}
          muted
          trimBefore={5 * fps}
          playbackRate={2.2}
          style={{ width: 1000 }}
        />
      </div>
      <div style={{ position: "absolute", left: 1200, top: 300, width: 620 }}>
        <div style={{ fontSize: 30, color: C.muted, fontWeight: 600, marginBottom: 26 }}>
          Ignition chain · wind NE 30 mph
        </div>
        {chain.map((c, i) => {
          const on = interpolate(frame, [c.at * fps, c.at * fps + 10], [0, 1], clamp);
          return (
            <div key={c.t} style={{ display: "flex", gap: 24, opacity: 0.25 + 0.75 * on }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    marginTop: 12,
                    background: c.hot ? C.fire : C.ember,
                    boxShadow: on > 0.5 ? `0 0 30px ${c.hot ? C.fire : C.ember}` : "none",
                  }}
                />
                {i < chain.length - 1 ? (
                  <div style={{ width: 4, height: 90, background: "rgba(255,122,47,0.4)" }} />
                ) : null}
              </div>
              <div>
                <div style={{ fontSize: 30, color: C.ember, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {c.t}
                </div>
                <div style={{ fontSize: c.hot ? 52 : 42, fontWeight: 800, color: c.hot ? C.fire : C.paper }}>
                  {c.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SceneFade>
  );
};

/* ---------- 6. HOW 3: fix, verify, every wind ---------- */
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
// Before the fixes: SW held in all 3 trials, W in 1 — 20 of 24 ignited.
const BEFORE_SAFE: Record<string, number> = { SW: 3, W: 1 };

export const HowFix: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gridAt = 5.6 * fps;
  const fixes = ["Move patio furniture", "Clean the gutters", "Clear plants within 5 ft", "Gravel instead of bark mulch"];
  const toGrid = interpolate(frame, [gridAt - 8, gridAt + 8], [0, 1], clamp);
  const flip = (i: number) => interpolate(frame, [gridAt + 40 + i * 2, gridAt + 50 + i * 2], [0, 1], clamp);
  return (
    <SceneFade style={{ backgroundColor: C.ink, color: C.paper }}>
      <div style={{ position: "absolute", left: 120, top: 90 }}>
        <Kicker color={C.greenBright}>How · 3 · Fix and verify</Kicker>
        <div style={{ fontSize: 64, fontWeight: 800, marginTop: 14 }}>
          {toGrid < 0.5 ? "Same storm, same seed — after the fixes" : "24 managed agents test every wind"}
        </div>
      </div>
      {/* Part A: re-run */}
      <AbsoluteFill style={{ opacity: 1 - toGrid }}>
        <div
          style={{
            position: "absolute",
            left: 120,
            top: 290,
            width: 1000,
            height: 805,
            borderRadius: 24,
            overflow: "hidden",
          }}
        >
          <Video
            src={staticFile("clips/burn_after.mp4")}
            muted
            trimBefore={9 * fps}
            playbackRate={2.2}
            style={{ width: 1000 }}
          />
        </div>
        <div style={{ position: "absolute", left: 1200, top: 300, width: 620 }}>
          <div style={{ fontSize: 30, color: C.muted, fontWeight: 600, marginBottom: 20 }}>From a vetted fix catalog</div>
          {fixes.map((f, i) => (
            <Rise key={f} delay={Math.round((0.6 + i * 0.5) * fps)} distance={16}>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 600,
                  padding: "16px 22px",
                  marginBottom: 14,
                  borderRadius: 16,
                  background: "rgba(79,176,122,0.12)",
                  border: `2px solid ${C.greenBright}`,
                }}
              >
                ✓ {f}
              </div>
            </Rise>
          ))}
          <Rise delay={Math.round(3.4 * fps)}>
            <div style={{ fontSize: 50, fontWeight: 800, color: C.greenBright, marginTop: 24 }}>
              Chain broken.
              <div style={{ fontSize: 34, fontWeight: 600, color: C.paper }}>No house ignition.</div>
            </div>
          </Rise>
        </div>
      </AbsoluteFill>
      {/* Part B: 24-scenario grid */}
      <AbsoluteFill style={{ opacity: toGrid }}>
        <div style={{ position: "absolute", left: 120, top: 300, display: "grid", gridTemplateColumns: "90px repeat(3, 230px)", gap: 14 }}>
          {DIRS.map((d, r) => (
            <React.Fragment key={d}>
              <div style={{ fontSize: 34, fontWeight: 700, color: C.muted, alignSelf: "center" }}>{d}</div>
              {[0, 1, 2].map((s) => {
                const safeBefore = s < (BEFORE_SAFE[d] ?? 0);
                const p = flip(r * 3 + s);
                return (
                  <div
                    key={s}
                    style={{
                      height: 66,
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 26,
                      fontWeight: 700,
                      background: safeBefore || p > 0.5 ? "rgba(79,176,122,0.2)" : "rgba(224,69,43,0.25)",
                      border: `2px solid ${safeBefore || p > 0.5 ? C.greenBright : C.fire}`,
                      scale: p > 0 && p < 1 ? String(1 - Math.sin(p * Math.PI) * 0.12) : "1",
                    }}
                  >
                    {safeBefore || p > 0.5 ? "✓ Held" : "Ignited"}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <div style={{ position: "absolute", left: 1080, top: 360 }}>
          <div style={{ fontSize: 34, color: C.muted, fontWeight: 600 }}>8 winds × 3 trials, each re-checked locally</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 30, marginTop: 40 }}>
            <div style={{ fontSize: 150, fontWeight: 800, color: C.fire, opacity: 1 - 0.6 * flip(23) }}>20</div>
            <div style={{ fontSize: 80, color: C.muted }}>→</div>
            <div style={{ fontSize: 150, fontWeight: 800, color: C.greenBright, opacity: flip(23) }}>0</div>
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, marginTop: 6 }}>of 24 scenarios ignite</div>
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};

/* ---------- 7. WHAT YOU GET + end card ---------- */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const endAt = 3.0 * fps;
  const end = interpolate(frame, [endAt, endAt + 14], [0, 1], clamp);
  return (
    <SceneFade inFrames={10} outFrames={1} style={{ backgroundColor: C.paper, color: C.ink }}>
      <AbsoluteFill style={{ opacity: 1 - end }}>
        <div style={{ position: "absolute", left: 120, top: 90 }}>
          <Kicker color={C.green}>What you get</Kicker>
          <div style={{ fontSize: 64, fontWeight: 800, marginTop: 14 }}>A ranked action plan, cheapest first</div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 120,
            top: 280,
            width: 1680,
            height: 760,
            overflow: "hidden",
            borderRadius: 24,
            boxShadow: "0 30px 90px rgba(0,0,0,0.18)",
          }}
        >
          <Img
            src={staticFile("shots/app_plan.png")}
            style={{
              position: "absolute",
              width: 1920 * 1.4,
              left: interpolate(frame, [0, endAt], [-700, -1000], { ...clamp, easing: ease }),
              top: -150,
            }}
          />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: end, justifyContent: "center", alignItems: "center", backgroundColor: C.ink, color: C.paper }}>
        <Embers count={40} seed="outro" opacity={0.6} />
        <div style={{ fontSize: 170, fontWeight: 800, letterSpacing: -5, scale: String(0.95 + 0.05 * end) }}>
          Zone<span style={{ color: C.ember }}>Zero</span>
        </div>
        <div style={{ fontSize: 56, fontWeight: 600, marginTop: 10 }}>Know what to fix before the embers arrive.</div>
        <div style={{ fontSize: 28, color: C.muted, marginTop: 70 }}>
          Built with Gemini 4 Argon + Managed Agents · A planning aid, not a certified assessment
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
