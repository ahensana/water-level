import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export async function exportNodeAsPng(node: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
  const link = document.createElement("a");
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export async function exportNodeAsPdf(node: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
  const imgData = canvas.toDataURL("image/png");

  const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
  const pdf = new jsPDF({ orientation, unit: "px", format: [canvas.width, canvas.height] });
  pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
  pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
