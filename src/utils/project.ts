import type { Stroke } from "../types/canvas";

export const saveProject = (
  strokes: Stroke[]
) => {
  const blob = new Blob(
    [JSON.stringify(strokes)],
    {
      type: "application/json",
    }
  );

  const link =
    document.createElement("a");

  link.href =
    URL.createObjectURL(blob);

  link.download =
    `project-${Date.now()}.drawbot`;

  link.click();

  URL.revokeObjectURL(link.href);
};

export const loadProject = (
  file: File
): Promise<Stroke[]> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(
        JSON.parse(
          reader.result as string
        )
      );
    };

    reader.readAsText(file);
  });
};