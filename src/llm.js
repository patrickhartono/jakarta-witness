/* llm.js — main-thread wrapper around the LLM Web Worker.
 *
 * Exposes a small promise-based API: load() resolves when the model is
 * downloaded + warmed up; generate() streams tokens and resolves with
 * the full text. */

export class LLM {
  constructor() {
    this.worker = new Worker(new URL('./llm.worker.js', import.meta.url), {
      type: 'module',
    });
    this._mode = 'idle'; // 'idle' | 'loading' | 'generating'
    this._onProgress = null;
    this._onToken = null;
    this._resolve = null;
    this._reject = null;

    this.worker.onmessage = (e) => this._handleMessage(e.data);
    this.worker.onerror = (err) => {
      const reject = this._reject;
      this._settle();
      reject?.(err);
    };
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'progress':
        this._onProgress?.(msg.data);
        break;
      case 'ready': {
        const resolve = this._resolve;
        this._settle();
        resolve?.();
        break;
      }
      case 'token':
        this._onToken?.(msg.text);
        break;
      case 'done': {
        const resolve = this._resolve;
        this._settle();
        resolve?.(msg.text);
        break;
      }
      case 'error': {
        const reject = this._reject;
        this._settle();
        reject?.(new Error(`[llm:${msg.phase}] ${msg.error}`));
        break;
      }
    }
  }

  _settle() {
    this._mode = 'idle';
    this._resolve = null;
    this._reject = null;
    this._onToken = null;
  }

  /**
   * Download + initialise the model.
   * @param {(p: object) => void} onProgress  Transformers.js progress events
   * @returns {Promise<void>}
   */
  load(onProgress) {
    this._onProgress = onProgress || null;
    this._mode = 'loading';
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this.worker.postMessage({ type: 'load' });
    });
  }

  /**
   * Generate one analysis from a scene-state object.
   * @param {object} scene     internal detection JSON
   * @param {(t: string) => void} onToken  streamed text chunks
   * @returns {Promise<string>}  full generated text
   */
  generate(scene, onToken) {
    if (this._mode !== 'idle') {
      return Promise.reject(new Error('LLM busy'));
    }
    this._onToken = onToken || null;
    this._mode = 'generating';
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this.worker.postMessage({ type: 'generate', scene });
    });
  }
}
