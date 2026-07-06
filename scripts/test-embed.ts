import "dotenv/config";
import { getEmbedder } from "@/lib/ai";

// Verifies the local embedder works (downloads model on first run) and that
// cosine similarity behaves: related texts should score higher than unrelated.
function cosine(a: number[], b: number[]) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already L2-normalized
}

async function main() {
  const e = getEmbedder();
  console.log("embedder:", e.name, "dims:", e.dimensions);
  const [a, b, c] = await e.embed([
    "Leadership development training for managers",
    "Management and leadership skills program for team leads",
    "Industrial welding safety certification",
  ]);
  console.log("vector length:", a.length);
  console.log("related (leadership vs management):", cosine(a, b).toFixed(3));
  console.log("unrelated (leadership vs welding):", cosine(a, c).toFixed(3));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
