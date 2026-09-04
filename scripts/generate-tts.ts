import "dotenv/config";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import type {Caption} from "@remotion/captions";

type Alignment = {characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[]};
type ElevenResponse = {audio_base64: string; normalized_alignment?: Alignment; alignment?: Alignment};

const toCaptions = (alignment: Alignment): Caption[] => {
  const captions: Caption[] = [];
  let word = "";
  let first = -1;
  let last = -1;
  const commit = () => {
    if (!word || first < 0 || last < 0) return;
    captions.push({text: word, startMs: Math.round(alignment.character_start_times_seconds[first] * 1000), endMs: Math.round(alignment.character_end_times_seconds[last] * 1000), timestampMs: null, confidence: null});
    word = ""; first = -1; last = -1;
  };
  // ElevenLabs alignment is character-level. Split only on literal spaces so punctuation stays with its word.
  alignment.characters.forEach((character, index) => {
    if (character === " ") { commit(); return; }
    if (first < 0) first = index;
    word += character;
    last = index;
  });
  commit();
  return captions;
};

const main = async () => {
  const narrationPath = process.argv[2];
  if (!narrationPath) throw new Error("Usage: tsx scripts/generate-tts.ts <narration.txt>");
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is missing from .env");
  const text = readFileSync(narrationPath, "utf8").trim();
  if (!text) throw new Error("Narration is empty");
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "onwK4e9ZLuTAKqWW03F9";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "xi-api-key": apiKey},
    body: JSON.stringify({text, model_id: "eleven_multilingual_v2"}),
  });
  if (!response.ok) throw new Error(`ElevenLabs request failed: ${response.status} ${await response.text()}`);
  const body = await response.json() as ElevenResponse;
  const alignment = body.normalized_alignment ?? body.alignment;
  if (!body.audio_base64 || !alignment) throw new Error("ElevenLabs did not return audio and alignment timestamps");
  mkdirSync("public", {recursive: true});
  writeFileSync("public/narration.mp3", Buffer.from(body.audio_base64, "base64"));
  writeFileSync("public/captions.json", `${JSON.stringify(toCaptions(alignment), null, 2)}\n`);
  console.log("Created public/narration.mp3 and public/captions.json");
};

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
