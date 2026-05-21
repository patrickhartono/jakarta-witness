/* llm.worker.js — runs the Qwen 2.5 1.5B Instruct LLM off the main thread.
 *
 * Heavy work (≈1.2 GB download, WebGPU shader compilation, token
 * generation) happens here so the artwork's animation never stutters.
 * Communicates with llm.js on the main thread via postMessage. */

import { pipeline, TextStreamer } from '@huggingface/transformers';
import { buildMessages } from './prompt.js';

// Qwen 2.5 0.5B (not 1.5B): the 1.5B q4 build (~1.8 GB) fails to allocate
// an inference session on this hardware (std::bad_alloc), and its q4f16
// build is numerically unstable on WebGPU. The 0.5B q4 build (~786 MB)
// loads reliably and, with the 8 few-shot examples, holds the format +
// voice well. A small local model also suits the work's concept.
const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

let generator = null;

/* Greedy decoding (do_sample:false) is fully deterministic — the only
 * reproducible option, since Transformers.js exposes no generation seed.
 * Determinism keeps the piece stable for screen recording (brief issue J). */
const GEN_CONFIG = {
  // Headroom for the prose + the trailing JSON line so the JSON is never
  // truncated mid-object (which makes it unparseable).
  max_new_tokens: 360,
  do_sample: false,
  repetition_penalty: 1.15,
};

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'load') {
    try {
      generator = await pipeline('text-generation', MODEL_ID, {
        device: 'webgpu',
        // q4 keeps activations in fp32 — stable, unlike q4f16 which gives
        // degenerate repeating-token output on WebGPU here.
        dtype: 'q4',
        progress_callback: (p) => self.postMessage({ type: 'progress', data: p }),
      });
      // Warm up WebGPU shader compilation with a tiny throwaway generation
      // so the first real cycle is not penalised by cold-start latency.
      await generator(buildMessages({ warmup: true }), { max_new_tokens: 2 });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', phase: 'load', error: String(err) });
    }
    return;
  }

  if (type === 'generate') {
    if (!generator) {
      self.postMessage({
        type: 'error',
        phase: 'generate',
        error: 'Model not loaded',
      });
      return;
    }
    try {
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => self.postMessage({ type: 'token', text }),
      });
      const out = await generator(buildMessages(e.data.scene), {
        ...GEN_CONFIG,
        streamer,
      });
      const full = out[0].generated_text.at(-1).content;
      self.postMessage({ type: 'done', text: full });
    } catch (err) {
      self.postMessage({ type: 'error', phase: 'generate', error: String(err) });
    }
    return;
  }
};
