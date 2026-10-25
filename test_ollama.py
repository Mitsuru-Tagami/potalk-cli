import json
import urllib.request

# OllamaのローカルAPIエンドポイント
url = "http://localhost:11434/api/generate"

# 送信するデータ
payload = {
    "model": "llama3.2",
    "prompt": "バナナ島サーバからの応答テストです。自己紹介を短くどうぞ。",
    "stream": False,
}

# リクエストの作成
req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)

try:
    print("Ollamaに問い合わせ中……")
    with urllib.request.urlopen(req) as response:
        res_body = response.read().decode("utf-8")
        result = json.loads(res_body)

        print("\n--- 応答結果 ---")
        print(result.get("response", "（返答なし）"))
        print("----------------")

except Exception as e:
    print(f"エラーが発生したよ: {e}")
