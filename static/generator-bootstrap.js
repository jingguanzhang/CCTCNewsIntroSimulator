import("./generator.js").catch((error) => {
  console.error(error);
  const el = document.getElementById("loading");
  el.textContent =
    "加载失败：" +
    error.message +
    "。请通过 HTTP / HTTPS 服务打开，并保留 static 目录。";
});
