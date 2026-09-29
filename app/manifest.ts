import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Comércio 360",
    short_name: "Comércio 360",
    description: "Visão central da operação do seu comércio.",
    start_url: "/app/visao-geral",
    display: "standalone",
    background_color: "#f5f7f7",
    theme_color: "#103f3b",
    lang: "pt-BR",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
