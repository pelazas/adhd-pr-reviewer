import {Audio, Video} from "@remotion/media";
import {loadFont} from "@remotion/fonts";
import {getAudioDurationInSeconds, getVideoMetadata} from "@remotion/media-utils";
import type {Caption} from "@remotion/captions";
import {Composition, Sequence, staticFile, type CalculateMetadataFunction} from "remotion";
import {Captions} from "./Captions";
import {DemoPane, type Emphasis} from "./DemoPane";

void Promise.all([
  loadFont({family: "CaptionLocal", url: staticFile("fonts/Arial-Bold.ttf"), weight: "700"}),
]);

type Props = {captions: Caption[]; emphasis?: Emphasis; demoDurationInFrames?: number};

const defaultEmphasis: Emphasis = {demoOffsetMs: 0, transitionMs: 1600, beats: []};

const metadata: CalculateMetadataFunction<Props> = async ({props}) => {
  // The MP3 is the source of truth; caption timing may end before its final breath.
  const [audioDuration, demo] = await Promise.all([
    getAudioDurationInSeconds(staticFile("narration.mp3")),
    getVideoMetadata(staticFile("demo.mp4")),
  ]);
  const trimBefore = Math.round(((props.emphasis ?? defaultEmphasis).demoOffsetMs / 1000) * 30);
  return {
    durationInFrames: Math.ceil(audioDuration * 30),
    props: {...props, emphasis: props.emphasis ?? defaultEmphasis, demoDurationInFrames: Math.max(1, Math.ceil(demo.durationInSeconds * 30) - trimBefore)},
  };
};

export const ADHDReview: React.FC<Props> = ({captions, emphasis = defaultEmphasis, demoDurationInFrames = 1}) => (
  <div style={{backgroundColor: "#17130f", height: "100%", width: "100%", overflow: "hidden"}}>
    <DemoPane emphasis={emphasis} demoDurationInFrames={demoDurationInFrames} />
    <div style={bottomStyle}>
      <Video src={staticFile("brainrot.mp4")} volume={0.14} loop objectFit="cover" style={mediaStyle} />
    </div>
    <Captions captions={captions} />
    <Sequence durationInFrames={60} layout="none"><div style={chipStyle}>PR #1 · pelazas/portfolio</div></Sequence>
    <Audio src={staticFile("narration.mp3")} />
  </div>
);

export const ADHDReviewComposition: React.FC = () => (
  <Composition
    id="ADHDReview"
    component={ADHDReview}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={{captions: [], emphasis: defaultEmphasis}}
    calculateMetadata={metadata}
  />
);

const bottomStyle: React.CSSProperties = {position: "absolute", top: 1056, left: 0, width: 1080, height: 864, overflow: "hidden"};
const mediaStyle: React.CSSProperties = {position: "absolute", width: "100%", height: "100%"};
const chipStyle: React.CSSProperties = {position: "absolute", top: 34, left: 34, zIndex: 5, fontFamily: "CaptionLocal", fontSize: 24, fontWeight: 700, color: "#fff", background: "rgba(20,16,12,.78)", border: "1px solid rgba(255,255,255,.55)", borderRadius: 30, padding: "12px 17px"};
