# Tools API

This project exposes internal tool schemas and tool handlers over HTTP.

## Endpoints

### `GET /tools`
Returns the list of tool schemas (OpenAI-compatible `tools[]`).

Response shape:

```json
{
  "tools": [
    { "type": "function", "function": { "name": "...", "parameters": {} } }
  ]
}
```

### `POST /tools/call`
Executes a tool handler.

Request:

```json
{
  "name": "vercel_get_latest_deployments",
  "arguments": {}
}
```

Response:

```json
{
  "ok": true,
  "result": {}
}
```

Errors:

- `400` invalid request
- `404` unknown tool
- `500` tool execution error
