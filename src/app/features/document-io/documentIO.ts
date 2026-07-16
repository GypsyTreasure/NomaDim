import { documentFromXml } from '../../../document';
import { commandBus } from '../../store/documentStore';

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
