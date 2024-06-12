export const sizeFormat = (size: number | string) => {
  if (!size) return;
  if (typeof size === "string") {
    size = parseInt(size);
  }
  if (size < 1024) {
    return `${size} B`;
  } else if (size < 1024 ** 2) {
    return `${(size / 1024).toFixed(2)} KB`;
  } else if (size < 1024 ** 3) {
    return `${(size / 1024 ** 2).toFixed(2)} MB`;
  } else {
    return `${(size / 1024 ** 3).toFixed(2)} GB`;
  }
};
