import { Composition, Sequence, staticFile, Track } from "remotion";
import { Audio } from "@remotion/media";
import { HowBurn, HowFix, HowModel, Outro, WhatIntro, WhyEmbers, WhyStakes } from "./scenes";

// Each scene is sized to its voiceover line (public/vo/s*.wav) plus a short breath.
// Total is exactly 1800 frames = 60.0 s at 30 fps.
export const MyComposition = () => {
  return (
    <Composition
      id="ZoneZeroDemo"
      component={ZoneZeroDemo}
      durationInFrames={1800}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};

export const ZoneZeroDemo: React.FC = () => {
  return (
    <>
      <Track name="Scenes">
        <Sequence name="Why · embers" from={0} durationInFrames={315}>
          <WhyEmbers />
        </Sequence>
        <Sequence name="Why · stakes" from={315} durationInFrames={201}>
          <WhyStakes />
        </Sequence>
        <Sequence name="What · ZoneZero" from={516} durationInFrames={202}>
          <WhatIntro />
        </Sequence>
        <Sequence name="How · model" from={718} durationInFrames={287}>
          <HowModel />
        </Sequence>
        <Sequence name="How · burn" from={1005} durationInFrames={229}>
          <HowBurn />
        </Sequence>
        <Sequence name="How · fix" from={1234} durationInFrames={329}>
          <HowFix />
        </Sequence>
        <Sequence name="What you get" from={1563} durationInFrames={237}>
          <Outro />
        </Sequence>
      </Track>
      <Track name="Voiceover">
        <Audio name="VO 1" src={staticFile("vo/s1.wav")} from={6} />
        <Audio name="VO 2" src={staticFile("vo/s2.wav")} from={321} />
        <Audio name="VO 3" src={staticFile("vo/s3.wav")} from={522} />
        <Audio name="VO 4" src={staticFile("vo/s4.wav")} from={724} />
        <Audio name="VO 5" src={staticFile("vo/s5.wav")} from={1011} />
        <Audio name="VO 6" src={staticFile("vo/s6.wav")} from={1240} />
        <Audio name="VO 7" src={staticFile("vo/s7.wav")} from={1569} />
      </Track>
    </>
  );
};
