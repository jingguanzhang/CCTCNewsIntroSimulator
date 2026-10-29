import("./editor.js")
  .then(() => document.getElementById("loadNotice")?.remove())
  .catch((error) => {
    console.error(error);
    document.getElementById("loadNotice")?.remove();
    const el = document.getElementById("toast");
    if (el) {
      el.hidden = false;
      el.classList.add("error");
      el.textContent =
        "启动失败：" +
        error.message +
        "。请保留 static 目录，并通过 HTTP 服务打开（npm start），不要直接双击 HTML。";
    }
    document.getElementById("engineStatus").textContent = "资源加载失败";
  });
