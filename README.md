# Informed360

## Run locally

```bash
npm install
npm start
```

Server runs on `http://localhost:3000` by default.

## Transformer sentiment (optional)

Transformer sentiment is optional and disabled by default. To enable it:

1. Install the optional dependency:
   ```bash
   npm install @xenova/transformers
   ```
2. Run the server with:
   ```bash
   TRANSFORMER_ENABLED=1 npm start
   ```

You can override the model and timeout if needed:

```bash
TRANSFORMER_ENABLED=1 \
TRANSFORMER_MODEL="Xenova/distilbert-base-uncased-finetuned-sst-2-english" \
TRANSFORMER_TIMEOUT_MS=1400 \
npm start
```

If the transformer is unavailable or the text is too short, the service falls back to VADER.
