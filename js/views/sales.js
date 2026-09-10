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
        <div class="page-eyebrow">Sales Tracker</div>
        <h1>${brand.name}</h1>
      </div>
    </div>
    <div class="content-view-card" style="max-width:480px;cursor:default;">
      <div class="icon-wrap">${icon("folder", { size: 22 })}</div>
      <h3>Coming soon</h3>
      <p>Track transactions, revenue, products/services sold, customers, and payments — and eventually connect it back to which campaigns and content actually drove the business result.</p>
    </div>
  `;

  return () => {};
}
