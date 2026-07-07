import { ElectronLibrarySource } from './electron-library-source.js';
import { FsaLibrarySource } from './fsa-library-source.js';
import { ImportLibrarySource } from './import-library-source.js';

export function createLibrarySource({ windowRef = globalThis.window } = {}) {
  const isElectron = windowRef?.electronIntegration?.isElectronEnvironment?.() ||
    windowRef?.electronIntegration?.isElectron;
  if (isElectron && windowRef?.electronAPI?.library) {
    return new ElectronLibrarySource(windowRef.electronAPI.library);
  }
  if (windowRef && 'showDirectoryPicker' in windowRef) {
    return new FsaLibrarySource(windowRef);
  }
  return new ImportLibrarySource(windowRef);
}
