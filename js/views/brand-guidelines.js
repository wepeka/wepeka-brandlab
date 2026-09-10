import { getBrand } from "../store.js";
import { icon } from "../icons.js";

export function render(root, { brandId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Brand Guidelines</div>
        <h1>${brand.name}</h1>
      </div>
    </div>
    <div class="content-view-card" style="max-width:480px;cursor:default;">
      <div class="icon-wrap">${icon("book", { size: 22 })}</div>
      <h3>Coming soon</h3>
      <p>Turn this brand's DNA into a consistent visual and communication system — typography, color palette, visual style, and brand voice, with AI recommendations based on what's already in Brand DNA.</p>
    </div>
  `;

  return () => {};
}
