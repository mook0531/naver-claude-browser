// 네이버 쇼핑 API 설정 창
const $ = (id) => document.getElementById(id);
const say = (text, cls) => { $("msg").textContent = text; $("msg").className = cls || ""; };

window.api.naverApi.status().then((s) => {
  $("cid").value = s.id || "";
  if (s.configured) say("설정되어 있습니다. 바꾸려면 새 값을 입력하고 저장하세요.", "ok");
});

$("open-dev").onclick = () => window.api.openExternal("https://developers.naver.com/apps/#/register");

$("save").onclick = async () => {
  const id = $("cid").value.trim(), secret = $("secret").value.trim();
  if (!id || !secret) return say("Client ID와 Client Secret을 모두 입력하세요.", "err");
  try {
    await window.api.naverApi.save(id, secret);
    $("secret").value = "";
    say("저장했습니다. '연결 테스트'로 확인해 보세요.", "ok");
  } catch (e) { say(e.message, "err"); }
};

$("export").onclick = async () => {
  const r = await window.api.naverApi.exportKeyFile();
  if (r.ok) say(`저장했습니다: ${r.filePath}`, "ok");
  else if (r.error) say(r.error, "err");
};

$("test").onclick = async () => {
  say("확인 중…");
  const r = await window.api.naverApi.test();
  if (r.ok) say(`연결 성공: "노트북" 검색 결과 ${r.total.toLocaleString("ko-KR")}건`, "ok");
  else say(r.error, "err");
};
