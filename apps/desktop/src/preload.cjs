const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("qpilotDesktop", {
  platform: process.platform,
  desktopMode: true
});
