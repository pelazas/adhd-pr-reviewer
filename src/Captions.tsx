import type {Caption} from "@remotion/captions";
import {useCurrentFrame, useVideoConfig} from "remotion";

const phraseGapMs = 300;
const maxPhraseChars = 42;

type Phrase = {text: string; startMs: number; endMs: number};

export const phrasesFromCaptions = (captions: Caption[]): Phrase[] => {
  const phrases: Phrase[] = [];
  let words: Caption[] = [];
  const flush = () => {
    if (!words.length) return;
    phrases.push({
      text: words.map((word) => word.text).join(" "),
      startMs: words[0].startMs,
      endMs: words[words.length - 1].endMs,
    });
    words = [];
  };
  for (const caption of captions) {
    const previous = words[words.length - 1];
    const gap = previous ? caption.startMs - previous.endMs : 0;
    const joined = [...words, caption].map((word) => word.text).join(" ");
    const punct = Boolean(previous && /[.,;:!?]$/.test(previous.text));
    if (words.length && (gap >= phraseGapMs || punct || joined.length > maxPhraseChars)) flush();
    words.push(caption);
  }
  flush();
  return phrases;
};

export const Captions: React.FC<{captions: Caption[]}> = ({captions}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const now = (frame / fps) * 1000;
  const phrases = phrasesFromCaptions(captions);
  let phrase: Phrase | null = null;
  for (const candidate of phrases) {
    if (now >= candidate.startMs) phrase = candidate;
  }
  if (!phrase) return null;
  const next = phrases[phrases.indexOf(phrase) + 1];
  if (next && now >= next.startMs) phrase = next;
  const wrapped = wrapPhrase(phrase.text, 26);

  return (
    <div style={styles.wrap}>
      <div style={styles.line}>{wrapped}</div>
    </div>
  );
};

const wrapPhrase = (text: string, maxChars: number) => {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.join("\n");
};

const outline = "3px #15110e, 3px 0 #15110e, 0 3px #15110e, -3px 0 #15110e";
const styles: Record<string, React.CSSProperties> = {
  wrap: {position: "absolute", bottom: 48, left: 40, right: 40, zIndex: 4, textAlign: "center"},
  line: {fontFamily: "CaptionLocal", fontSize: 46, fontWeight: 700, lineHeight: 1.14, color: "#fff", whiteSpace: "pre-wrap", textShadow: outline},
};
