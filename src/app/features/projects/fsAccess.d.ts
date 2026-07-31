/**
 * Minimal ambient types for the File System Access API pieces the standard
 * lib.dom.d.ts still omits (ADR-0089): the `showDirectoryPicker` entry point,
 * the handle permission methods, and the directory async iterator. Chromium
 * only — every caller feature-detects `isFolderAccessSupported()` first, so on
 * unsupported browsers these are simply never reached.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | string;
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
