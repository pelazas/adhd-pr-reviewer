import {createTikTokStyleCaptions, type Caption} from "@remotion/captions";
import {useCurrentFrame, useVideoConfig} from "remotion";

export const Captions: React.FC<{captions: Caption[]}> = ({captions}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const now = (frame / fps) * 1000;
  const {pages} = createTikTokStyleCaptions({
    captions: captions.map((caption, index) => ({...caption, pageBreakAfter: index % 5 === 4})),
    combineTokensWithinMilliseconds: 1200,
  });
  const page = pages.find((candidate) => now >= candidate.startMs && now < candidate.startMs + candidate.durationMs);
  if (!page) return null;
  let charactersOnLine = 0;

  return (
    <div style={styles.wrap}>
      <div style={styles.line}>
        {page.tokens.map((token, index) => {
          const separator = index === 0 ? "" : charactersOnLine + token.text.length + 1 > 25 ? "\n" : " ";
          charactersOnLine = separator === "\n" ? token.text.length : charactersOnLine + token.text.length + (separator ? 1 : 0);
          const active = now >= token.fromMs && now < token.toMs;
          return <span key={`${token.fromMs}-${index}`} style={active ? styles.active : styles.word}>{separator}{token.text}</span>;
        })}
      </div>
    </div>
  );
};

const outline = "3px #15110e, 3px 0 #15110e, 0 3px #15110e, -3px 0 #15110e";
const styles: Record<string, React.CSSProperties> = {
  wrap: {position: "absolute", top: 1075, left: 50, right: 50, zIndex: 4, textAlign: "center"},
  line: {fontFamily: "CaptionLocal", fontSize: 56, fontWeight: 700, lineHeight: 1.14, color: "white", whiteSpace: "pre", textShadow: outline},
  word: {color: "#fff", textShadow: outline},
  active: {color: "#39E508", textShadow: outline},
};
