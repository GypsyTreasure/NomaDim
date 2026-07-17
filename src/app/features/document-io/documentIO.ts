import { documentFromXml, documentToXml, type DocumentState } from '../../../document';
import { commandBus } from '../../store/documentStore';

/**
 * Document file IO (F7): the load path shared by the Open button, drag-drop,
 * and the New Project export guard. Loading replays through the write path
 * (parse + validate, then `commandBus.loadDocument` → full regen); saving
 * serializes the current document to a downloaded `.nomadim.xml`.
 */

export const DOCUMENT_FILE_NAME = 'model.nomadim.xml';

/**
 * Loads `.nomadim.xml` document text through the write path (F7): parse +
 * validate, then replace the document via the bus (full regen). Returns null
 * on success, else an error message. Shared by the Open button and drag-drop.
 */
export function loadDocumentText(text: string): string | null {
  const result = documentFromXml(text);
  if (!result.ok) return result.error.detail ?? result.error.message;
  commandBus.loadDocument(result.value);
  return null;
}

/** Serializes the document and triggers a browser download of the .nomadim.xml. */
export function downloadDocument(doc: DocumentState, fileName = DOCUMENT_FILE_NAME): void {
  const blob = new Blob([documentToXml(doc)], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
