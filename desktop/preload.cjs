const { contextBridge, ipcRenderer } = require('electron');
const invoke = (method, value) => ipcRenderer.invoke(`slity:${method}`, value);
contextBridge.exposeInMainWorld('agentSlity', Object.freeze({
  plan: value => invoke('plan', value), openSnapshot: kind => invoke('openSnapshot', kind),
  chooseExecutable: () => invoke('chooseExecutable'), chooseWorkspace: () => invoke('chooseWorkspace'),
  run: value => invoke('run', value), compare: value => invoke('compare', value),
  cancel: () => invoke('cancel'), save: value => invoke('save', value),
  onProgress: callback => {
    if (typeof callback !== 'function') throw new TypeError('콜백이 필요합니다.');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('slity:progress', listener);
    return () => ipcRenderer.removeListener('slity:progress', listener);
  },
}));
