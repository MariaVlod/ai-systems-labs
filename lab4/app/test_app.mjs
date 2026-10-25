// Перевірка логіки застосунку без реальної моделі: підставний OpenAI-сумісний сервер.  Запуск: node test_app.mjs
import http from "node:http";
import assert from "node:assert/strict";
import { AppError, generateCards, parseCards, toTsv } from "./app.js";

// --- розбір відповіді моделі ---
const ok = '{"cards":[{"question":"Що таке X?","answer":"Це Y."}]}';
assert.equal(parseCards(ok).length, 1);
assert.equal(parseCards("```json\n" + ok + "\n```").length, 1);                       // огортка markdown
assert.equal(parseCards("Ось картки: " + ok).length, 1);                                // текст перед JSON
assert.equal(parseCards('[{"question":"a","answer":"b"}]').length, 1);                  // голий масив
assert.throws(() => parseCards("просто текст"), AppError);                              // немає JSON
assert.throws(() => parseCards('{"cards":[{"question":"a","ans'), AppError);            // обрізаний JSON
assert.throws(() => parseCards('{"cards":[{"question":"a"}]}'), AppError);              // немає answer
assert.equal(toTsv([{ question: "q\n1", answer: "a\tb" }]), "q 1\ta b\n");

// --- підставний сервер ---
let mode = "ok";
const server = http.createServer((req, res) => {
  if (mode === "404") { res.writeHead(404); return res.end('{"error":"model not found"}'); }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const text = mode === "truncated" ? '{"cards":[{"question":"a","ans' : ok;
  const chunk = (d, f = null) => `data: ${JSON.stringify({ choices: [{ delta: d, finish_reason: f }] })}\n\n`;
  for (const piece of text.match(/.{1,7}/g)) res.write(chunk({ content: piece }));
  res.write(chunk({}, mode === "truncated" ? "length" : "stop"));
  res.end("data: [DONE]\n\n");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const cfg = { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: "m", temperature: 0.3, maxTokens: 100, timeoutS: 5 };

let progress = 0;
const r = await generateCards(cfg, "нотатки", 1, (n) => (progress = n));
assert.equal(r.finishReason, "stop");
assert.equal(progress, ok.length);
assert.equal(parseCards(r.text).length, 1);

mode = "truncated";
const t = await generateCards(cfg, "нотатки", 1);
assert.equal(t.finishReason, "length");
assert.throws(() => parseCards(t.text), AppError);

mode = "404";
await assert.rejects(generateCards(cfg, "нотатки", 1), /не знайдено/);

server.close();
await assert.rejects(generateCards(cfg, "нотатки", 1), /Сервер недоступний/);   // сервер не запущено

console.log("Усі перевірки пройдено");
