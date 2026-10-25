async function askOllama(promptText) {
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt: promptText,
        stream: false
      })
    });

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error('Ollamaとの通信に失敗したよ:', error);
    return null;
  }
}

// テスト実行
console.log("Ollamaに問い合わせ中（Node.js標準fetch）……");
const reply = await askOllama("バナナ島サーバからのNode.js連携テストです。短く元気に挨拶して！");

console.log("\n--- 応答結果 ---");
console.log(reply);
console.log("----------------");
