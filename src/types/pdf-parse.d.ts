/**
 * Defines local types for `pdf-parse` until the dependency publishes its own declarations.
 */
declare module 'pdf-parse' {
  /**
   * Contains the text and metadata extracted from a parsed PDF document.
   */
  interface PDFData {
    /** Total number of pages in the parsed document. */
    numpages: number;
    /** Number of pages that the parser rendered during processing. */
    numrender: number;
    /** PDF document information metadata, when the document provides it. */
    info: Record<string, unknown>;
    /** Additional PDF metadata in the parser-specific representation. */
    metadata: unknown;
    /** Text extracted from the document pages. */
    text: string;
    /** Version of the PDF parser that produced this result. */
    version: string;
  }

  /**
   * Parses a PDF buffer and resolves to its text and metadata.
   *
   * @param dataBuffer Bytes of the PDF document to parse.
   * @returns The extracted document data.
   */
  function pdfParse(dataBuffer: Buffer): Promise<PDFData>;

  export = pdfParse;
}
