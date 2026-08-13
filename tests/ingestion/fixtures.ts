import { Document, Packer, Paragraph } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** 用 pdf-lib 生成一段含指定文本的文本型 PDF（标准字体不支持中文，用英文）。 */
export async function pdfBuffer(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedStandardFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText(text, { x: 50, y: 150, font, size: 20 });
  return Buffer.from(await doc.save());
}

/** 用 docx 库生成一个段落文档。 */
export async function docxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((t) => new Paragraph(t)) }] });
  return Packer.toBuffer(doc);
}
