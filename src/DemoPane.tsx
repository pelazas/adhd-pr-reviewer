import {Video} from "@remotion/media";
import {Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";

export type EmphasisBeat = {
  startMs: number;
  endMs: number;
  scale: number;
  x: number;
  y: number;
  rect: {x: number; y: number; w: number; h: number} | null;
  approachStartMs?: number;
};

export type Emphasis = {demoOffsetMs: number; transitionMs?: number; beats: EmphasisBeat[]};

type Props = {emphasis: Emphasis; demoDurationInFrames: number};
type Camera = {scale: number; tx: number; ty: number};

const paneW = 1080;
const paneH = 1056;
const ease = Easing.bezier(0.4, 0, 0.2, 1);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const project = (scale: number, cx: number, cy: number) => {
  const zoom = Math.max(1, scale);
  const tx = clamp(paneW / 2 - zoom * cx, paneW * (1 - zoom), 0);
  const ty = clamp(paneH * 0.42 - zoom * cy, paneH * (1 - zoom), 0);
  return {scale: zoom, tx, ty};
};

const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;

const cameraAt = (beats: EmphasisBeat[], now: number, transitionMs: number): Camera => {
  if (!beats.length) return {scale: 1, tx: 0, ty: 0};
  let index = 0;
  for (let cursor = 0; cursor < beats.length; cursor++) {
    if (now >= beats[cursor].startMs) index = cursor;
  }
  const beat = beats[index];
  const previous = index > 0 ? beats[index - 1] : beat;
  const arrive = beat.startMs;
  const depart = beat.approachStartMs ?? (index > 0 ? arrive - transitionMs : arrive);
  if (index > 0 && now < arrive) {
    const progress = interpolate(now, [depart, arrive], [0, 1], {easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp"});
    return project(mix(previous.scale, beat.scale, progress), mix(previous.x * paneW, beat.x * paneW, progress), mix(previous.y * paneH, beat.y * paneH, progress));
  }
  return project(beat.scale, beat.x * paneW, beat.y * paneH);
};

export const DemoPane: React.FC<Props> = ({emphasis, demoDurationInFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const now = (frame / fps) * 1000;
  const camera = cameraAt(emphasis.beats, now, emphasis.transitionMs ?? 1800);
  const trimBefore = Math.max(0, Math.round((emphasis.demoOffsetMs / 1000) * fps));

  return (
    <div style={paneStyle}>
      <div style={{...layerStyle, transform: `translate(${camera.tx}px, ${camera.ty}px) scale(${camera.scale})`, transformOrigin: "0 0"}}>
        <Img src={staticFile("demo-last.png")} style={mediaStyle} />
        <Sequence durationInFrames={demoDurationInFrames} layout="none">
          <Video src={staticFile("demo.mp4")} muted trimBefore={trimBefore} objectFit="fill" style={mediaStyle} />
        </Sequence>
      </div>
    </div>
  );
};

const paneStyle: React.CSSProperties = {position: "absolute", top: 0, left: 0, width: paneW, height: paneH, overflow: "hidden"};
const layerStyle: React.CSSProperties = {position: "absolute", width: "100%", height: "100%"};
const mediaStyle: React.CSSProperties = {position: "absolute", width: "100%", height: "100%"};
