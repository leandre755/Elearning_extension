export default [
  {
    ignores: ["lib/**", "graphify-out/**", "icons/**", "eslint.config.js"]
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        chrome: "readonly",
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        history: "readonly",
        Event: "readonly",
        Node: "readonly",
        ImageCapture: "readonly",
        SchemaDetector: "readonly",
        SchemaCache: "readonly",
        QuizProviders: "readonly",
        createImageBitmap: "readonly",
        btoa: "readonly",
        Blob: "readonly",
        Uint8Array: "readonly",
        ArrayBuffer: "readonly",
        TextDecoder: "readonly",
        Promise: "readonly",
        AbortController: "readonly",
        fetch: "readonly",
        Object: "readonly",
        Math: "readonly",
        Set: "readonly",
        Map: "readonly",
        String: "readonly",
        JSON: "readonly",
        Error: "readonly",
        URL: "readonly",
        Image: "readonly",
        XMLSerializer: "readonly",
        FileReader: "readonly",
        MutationObserver: "readonly",
        IntersectionObserver: "readonly",
        confirm: "readonly",
        location: "readonly",
        pdfjsLib: "readonly",
        mammoth: "readonly",
        require: "readonly",
        __dirname: "readonly",
        module: "readonly",
        self: "readonly",
        importScripts: "readonly",
        ServiceWorkerGlobalScope: "readonly",
        BackgroundAgent: "readonly"
      }
    },
    rules: {
      "no-undef": "error"
    }
  }
];
