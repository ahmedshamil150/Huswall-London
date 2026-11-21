import { adminApi } from '../api.js';
import { supabase } from '/shared/js/supabase.js';
import {
  escapeHtml,
  formatMoney,
  formatDateTime,
  pageHead,
  productStatusBadge,
  statusLabel,
  toast,
  setBusy,
  parsePriceToMinor,
  minorToInput,
  notice
} from '../ui.js';

const PRODUCT_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' }
];

function listQuery(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.status) params.set('status', state.status);
  params.set('page', String(state.page));
  params.set('pageSize', '20');
  return params.toString();
}

export async function renderProducts(view) {
  const state = { q: '', status: '', page: 1 };

  view.innerHTML = `
    ${pageHead({
      title: 'Products',
      subtitle: 'Catalogue, pricing and publication. Stock lives in Inventory.',
      actions: `<a class="btn" href="#/products/new">Add product</a>`
    })}
    <section class="card">
      <form class="toolbar" id="product-filters">
        <div class="field">
          <label for="product-search">Search</label>
          <input id="product-search" name="q" type="search" placeholder="Name, SKU or slug" value="">
        </div>
        <div class="field">
          <label for="product-status">Status</label>
          <select id="product-status" name="status">
            <option value="">All</option>
            ${PRODUCT_STATUSES.map(
              (option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`
            ).join('')}
          </select>
        </div>
        <button class="btn btn--ghost" type="submit">Filter</button>
        <span class="spacer"></span>
      </form>
      <div id="product-results"></div>
    </section>`;

  const results = view.querySelector('#product-results');

  async function load() {
    results.innerHTML = '<div class="empty">Loading products…</div>';
    try {
      const data = await adminApi(`/products?${listQuery(state)}`);
      results.innerHTML = `
        ${
          data.items?.length
            ? `<div class="table-wrap">
                 <table class="data-table">
                   <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Updated</th><th></th></tr></thead>
                   <tbody>
                     ${data.items
                       .map(
                         (product) => `<tr>
                           <td>
                             <div class="flex">
                               <img class="thumb" src="${escapeHtml(product.primary_image)}" alt="" width="42" height="52">
                               <div>
                                 <span class="cell-main">${escapeHtml(product.name)}</span>
                                 <span class="cell-sub mono">${escapeHtml(product.sku)}</span>
                               </div>
                             </div>
                           </td>
                           <td class="nowrap">${formatMoney(product.price_minor, product.currency)}</td>
                           <td>${escapeHtml(statusLabel(product.availability))}</td>
                           <td>${productStatusBadge(product.status)}</td>
                           <td class="nowrap small muted">${formatDateTime(product.updated_at)}</td>
                           <td class="right"><a class="btn btn--ghost btn--sm" href="#/products/${escapeHtml(
                             product.id
                           )}">Edit</a></td>
                         </tr>`
                       )
                       .join('')}
                   </tbody>
                 </table>
               </div>
               <div class="pagination">
                 <span>Page ${data.page} · ${data.total} product${data.total === 1 ? '' : 's'}</span>
                 <span class="cluster">
                   <button class="btn btn--ghost btn--sm" type="button" data-page="${data.page - 1}" ${
                     data.page <= 1 ? 'disabled' : ''
                   }>Previous</button>
                   <button class="btn btn--ghost btn--sm" type="button" data-page="${data.page + 1}" ${
                     data.page * data.pageSize >= data.total ? 'disabled' : ''
                   }>Next</button>
                 </span>
               </div>`
            : `<div class="empty">No products match those filters. <a class="link" href="#/products/new">Add the first product</a>.</div>`
        }`;

      results.querySelectorAll('[data-page]').forEach((button) => {
        button.addEventListener('click', () => {
          state.page = Number(button.dataset.page);
          load();
        });
      });
    } catch (error) {
      results.innerHTML = notice(escapeHtml(error.message), 'error');
    }
  }

  view.querySelector('#product-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.q = String(data.get('q') || '').trim();
    state.status = String(data.get('status') || '');
    state.page = 1;
    load();
  });

  await load();
}

async function uploadImage(file, folder) {
  if (!supabase) throw new Error('Supabase storage is not configured.');
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Images must be 8MB or smaller.');

  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(-80);
  const path = `${folder}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from('product-images').upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false
  });
  if (error) throw error;
  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

function imageRow(image = {}) {
  return `<div class="image-row">
    <img class="thumb" src="${escapeHtml(image.url || '/assets/products/placeholder.svg')}" alt="" width="48" height="60" data-image-thumb>
    <div class="image-fields">
      <input class="input" data-image-url type="text" placeholder="/assets/products/… or https://…" value="${escapeHtml(
        image.url || ''
      )}">
      <input class="input" data-image-alt type="text" placeholder="Alt text for accessibility" value="${escapeHtml(
        image.alt || ''
      )}">
      <label class="check"><input type="checkbox" data-image-primary ${
        image.is_primary ? 'checked' : ''
      }> <span>Primary image</span></label>
    </div>
    <button class="btn btn--ghost btn--sm" type="button" data-remove-image>Remove</button>
  </div>`;
}

function variantRow(variant = {}, index = 0) {
  return `<div class="variant-row" data-variant-id="${escapeHtml(variant.id || '')}">
    <div class="field">
      <label>Option name</label>
      <input class="input" data-variant-name type="text" value="${escapeHtml(variant.name || '')}" placeholder="180g">
    </div>
    <div class="field">
      <label>SKU</label>
      <input class="input" data-variant-sku type="text" value="${escapeHtml(variant.sku || '')}" placeholder="HL-…">
    </div>
    <div class="field">
      <label>Price (£)</label>
      <input class="input" data-variant-price type="number" min="0" step="0.01" value="${minorToInput(
        variant.price_minor ?? 0
      )}">
    </div>
    <div class="field">
      <label>Compare at (£)</label>
      <input class="input" data-variant-compare type="number" min="0" step="0.01" value="${
        variant.compare_at_price_minor ? minorToInput(variant.compare_at_price_minor) : ''
      }">
    </div>
    <div class="stack" style="gap:.35rem">
      <label class="check"><input type="checkbox" data-variant-active ${
        variant.is_active === false ? '' : 'checked'
      }> <span>Active</span></label>
      <button class="btn btn--danger btn--sm variant-remove" type="button" data-remove-variant>Remove</button>
    </div>
  </div>`;
}

export async function renderProductEditor(view, context, id) {
  const isNew = id === 'new';
  view.innerHTML = '<div class="empty">Loading product…</div>';

  let product = null;
  let categories = [];
  try {
    const [productResult, categoriesResult] = await Promise.all([
      isNew ? Promise.resolve(null) : adminApi(`/products/${id}`),
      adminApi('/categories')
    ]);
    product = productResult?.product ?? null;
    categories = categoriesResult.items ?? [];
  } catch (error) {
    view.innerHTML = notice(escapeHtml(error.message), 'error');
    return;
  }

  const selectedCategoryIds = new Set(
    (product?.product_categories ?? []).map((link) => link.category_id)
  );
  const existingVariants = new Map((product?.product_variants ?? []).map((variant) => [variant.id, variant]));
  const inventoryRows = product?.inventory ?? [];

  view.innerHTML = `
    ${pageHead({
      title: isNew ? 'Add product' : product.name,
      subtitle: isNew
        ? 'Create a draft first. Publish when copy, pricing and stock are ready.'
        : `SKU ${product.sku} · ${statusLabel(product.status)}`,
      actions: `<a class="btn btn--ghost" href="#/products">Back to products</a>`
    })}

    <div id="form-error" hidden></div>

    <form id="product-form" novalidate>
      <div class="editor-grid">
        <div class="stack">
          <section class="card">
            <div class="card__head"><h3>Identity</h3></div>
            <div class="card__body form-grid">
              <div class="field field--full">
                <label for="name">Name</label>
                <input id="name" name="name" type="text" required value="${escapeHtml(product?.name || '')}">
              </div>
              <div class="field">
                <label for="sku">SKU</label>
                <input id="sku" name="sku" type="text" required value="${escapeHtml(product?.sku || '')}">
              </div>
              <div class="field">
                <label for="slug">URL slug</label>
                <input id="slug" name="slug" type="text" value="${escapeHtml(product?.slug || '')}" placeholder="generated-from-name">
              </div>
              <div class="field field--full">
                <label for="brand">Brand</label>
                <input id="brand" name="brand" type="text" value="${escapeHtml(product?.brand || 'Hasswell London')}">
              </div>
              <div class="field field--full">
                <label for="short_description">Short description</label>
                <input id="short_description" name="short_description" type="text" maxlength="400" value="${escapeHtml(
                  product?.short_description || ''
                )}">
              </div>
              <div class="field field--full">
                <label for="description">Description</label>
                <textarea id="description" name="description" rows="8">${escapeHtml(product?.description || '')}</textarea>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card__head"><h3>Pricing &amp; shipping weight</h3></div>
            <div class="card__body form-grid form-grid--3">
              <div class="field">
                <label for="price">Price (£)</label>
                <input id="price" name="price" type="number" min="0" step="0.01" required value="${minorToInput(
                  product?.price_minor ?? 0
                )}">
              </div>
              <div class="field">
                <label for="compare_at_price">Compare at (£)</label>
                <input id="compare_at_price" name="compare_at_price" type="number" min="0" step="0.01" value="${
                  product?.compare_at_price_minor ? minorToInput(product.compare_at_price_minor) : ''
                }">
              </div>
              <div class="field">
                <label for="weight_grams">Weight (grams)</label>
                <input id="weight_grams" name="weight_grams" type="number" min="0" step="1" value="${
                  product?.weight_grams ?? ''
                }">
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <h3>Images</h3>
              <span class="cluster">
                <input type="file" id="image-upload" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden>
                <button class="btn btn--ghost btn--sm" type="button" id="upload-button">Upload image</button>
                <button class="btn btn--ghost btn--sm" type="button" id="add-image">Add URL</button>
              </span>
            </div>
            <div class="card__body">
              <div class="image-list" id="image-list">
                ${
                  (product?.product_images ?? []).length
                    ? [...product.product_images]
                        .sort(
                          (a, b) =>
                            Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order
                        )
                        .map(imageRow)
                        .join('')
                    : '<p class="muted small">No images yet. Add a URL or upload a file.</p>'
                }
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <h3>Options / variants</h3>
              <button class="btn btn--ghost btn--sm" type="button" id="add-variant">Add option</button>
            </div>
            <div class="card__body">
              <p class="small muted" style="margin-bottom:.8rem">
                A product with options uses the option price. Leave empty for a single-SKU product.
                Removing an existing option deactivates it; historical orders are preserved.
              </p>
              <div class="variant-list" id="variant-list">
                ${
                  (product?.product_variants ?? [])
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((variant, index) => variantRow(variant, index))
                    .join('') || ''
                }
              </div>
            </div>
          </section>
        </div>

        <div class="editor-side">
          <section class="card">
            <div class="card__head"><h3>Publication</h3></div>
            <div class="card__body stack">
              <div class="field">
                <label for="status">Status</label>
                <select id="status" name="status">
                  ${PRODUCT_STATUSES.map(
                    (option) =>
                      `<option value="${option.value}" ${
                        (product?.status || 'draft') === option.value ? 'selected' : ''
                      }>${escapeHtml(option.label)}</option>`
                  ).join('')}
                </select>
              </div>
              <label class="check"><input type="checkbox" name="is_featured" ${
                product?.is_featured ? 'checked' : ''
              }> <span>Featured</span></label>
              <label class="check"><input type="checkbox" name="is_best_seller" ${
                product?.is_best_seller ? 'checked' : ''
              }> <span>Best seller</span></label>
              <label class="check"><input type="checkbox" name="is_new_arrival" ${
                product?.is_new_arrival ? 'checked' : ''
              }> <span>New arrival</span></label>
            </div>
          </section>

          <section class="card">
            <div class="card__head"><h3>Categories</h3></div>
            <div class="card__body category-checks">
              ${
                categories.length
                  ? categories
                      .map(
                        (category) => `<label class="check">
                          <input type="checkbox" data-category value="${escapeHtml(category.id)}" ${
                            selectedCategoryIds.has(category.id) ? 'checked' : ''
                          }>
                          <span>${escapeHtml(category.name)}${category.is_active ? '' : ' (inactive)'}</span>
                        </label>`
                      )
                      .join('')
                  : '<p class="muted small">No categories yet. Add them from the store seed or API.</p>'
              }
            </div>
          </section>

          ${
            isNew
              ? `<section class="card"><div class="card__body"><p class="small muted">Save the product to manage stock and see inventory movements.</p></div></section>`
              : `<section class="card">
                   <div class="card__head"><h3>Stock</h3><a class="link small" href="#/inventory">All inventory</a></div>
                   <div class="card__body">
                     <div class="stock-list" id="stock-list">
                       ${
                         inventoryRows.length
                           ? inventoryRows
                               .map((row) => {
                                 const variant = (product.product_variants ?? []).find(
                                   (entry) => entry.id === row.variant_id
                                 );
                                 const available = Math.max(0, row.stock_on_hand - row.stock_reserved);
                                 return `<div class="stock-row" data-inventory-id="${escapeHtml(row.id)}" data-variant-id="${escapeHtml(
                                   row.variant_id || ''
                                 )}">
                                   <span class="grow"><strong>${escapeHtml(
                                     variant?.name || 'Single SKU'
                                   )}</strong><br><span class="small muted">On hand <span data-on-hand>${
                                     row.stock_on_hand
                                   }</span> · reserved <span data-reserved>${
                                     row.stock_reserved
                                   }</span> · available <span data-available>${available}</span></span></span>
                                   <input class="input" type="number" step="1" data-stock-delta placeholder="± qty" aria-label="Stock adjustment">
                                   <button class="btn btn--ghost btn--sm" type="button" data-adjust-stock>Adjust</button>
                                 </div>`;
                               })
                               .join('')
                           : '<p class="small muted">No inventory rows yet. Adjust stock from the Inventory page after saving.</p>'
                       }
                     </div>
                   </div>
                 </section>`
          }

          <section class="card">
            <div class="card__head"><h3>Search metadata</h3></div>
            <div class="card__body stack">
              <div class="field">
                <label for="meta_title">Meta title</label>
                <input id="meta_title" name="meta_title" type="text" maxlength="160" value="${escapeHtml(
                  product?.meta_title || ''
                )}">
              </div>
              <div class="field">
                <label for="meta_description">Meta description</label>
                <textarea id="meta_description" name="meta_description" maxlength="320" rows="3">${escapeHtml(
                  product?.meta_description || ''
                )}</textarea>
              </div>
            </div>
          </section>

          ${
            isNew
              ? ''
              : `<section class="card">
                   <div class="card__head"><h3>Danger zone</h3></div>
                   <div class="card__body">
                     <p class="small muted">Archiving removes the product from the storefront but keeps order history intact.</p>
                     <button class="btn btn--danger btn--sm" type="button" id="archive-product" style="margin-top:.8rem">Archive product</button>
                   </div>
                 </section>`
          }
        </div>
      </div>

      <div class="form-actions">
        <button class="btn" type="submit" id="save-product">${isNew ? 'Create product' : 'Save changes'}</button>
        <a class="btn btn--ghost" href="#/products">Cancel</a>
      </div>
    </form>`;

  const form = view.querySelector('#product-form');
  const errorBox = view.querySelector('#form-error');
  const imageList = view.querySelector('#image-list');
  const variantList = view.querySelector('#variant-list');

  function showError(message) {
    errorBox.hidden = false;
    errorBox.innerHTML = notice(escapeHtml(message), 'error');
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function addImageRow(image) {
    if (imageList.querySelector('p.muted')) imageList.innerHTML = '';
    imageList.insertAdjacentHTML('beforeend', imageRow(image));
  }

  imageList.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-image]');
    if (!remove) return;
    remove.closest('.image-row')?.remove();
    if (!imageList.children.length) {
      imageList.innerHTML = '<p class="muted small">No images yet.</p>';
    }
  });

  imageList.addEventListener('input', (event) => {
    if (!event.target.matches('[data-image-url]')) return;
    const row = event.target.closest('.image-row');
    const thumb = row.querySelector('[data-image-thumb]');
    if (thumb) thumb.src = event.target.value || '/assets/products/placeholder.svg';
  });

  view.querySelector('#add-image').addEventListener('click', () => addImageRow({}));

  const fileInput = view.querySelector('#image-upload');
  view.querySelector('#upload-button').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    if (!files.length) return;
    const button = view.querySelector('#upload-button');
    setBusy(button, true, 'Uploading…');
    try {
      for (const file of files) {
        const url = await uploadImage(file, isNew ? 'drafts' : product.id);
        addImageRow({ url, alt: product?.name || '', is_primary: !imageList.querySelector('input[data-image-primary]:checked') });
      }
      toast('Image uploaded.', 'success');
    } catch (error) {
      showError(error.message);
    } finally {
      fileInput.value = '';
      setBusy(button, false);
    }
  });

  variantList.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-variant]');
    if (!remove) return;
    remove.closest('.variant-row')?.remove();
  });
  view.querySelector('#add-variant').addEventListener('click', () => {
    variantList.insertAdjacentHTML('beforeend', variantRow({}, variantList.children.length));
  });

  view.querySelector('#stock-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-adjust-stock]');
    if (!button) return;
    const row = button.closest('.stock-row');
    const delta = Number(row.querySelector('[data-stock-delta]').value);
    if (!Number.isInteger(delta) || delta === 0) {
      toast('Enter a non-zero whole number.', 'error');
      return;
    }
    setBusy(button, true, 'Saving…');
    try {
      const result = await adminApi('/inventory', {
        method: 'POST',
        body: {
          product_id: product.id,
          variant_id: row.dataset.variantId || null,
          delta,
          note: `Admin adjustment from product editor`
        }
      });
      const inv = result.inventory;
      row.querySelector('[data-on-hand]').textContent = inv.stock_on_hand;
      row.querySelector('[data-reserved]').textContent = inv.stock_reserved;
      row.querySelector('[data-available]').textContent = inv.available;
      row.querySelector('[data-stock-delta]').value = '';
      toast('Stock updated.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });

  view.querySelector('#archive-product')?.addEventListener('click', async () => {
    if (!window.confirm(`Archive “${product.name}”? It will disappear from the storefront.`)) return;
    try {
      await adminApi(`/products/${id}`, { method: 'DELETE' });
      toast('Product archived.', 'success');
      context.navigate('/products');
    } catch (error) {
      showError(error.message);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;

    const price = parsePriceToMinor(form.elements.price.value);
    if (price === null) {
      showError('Enter a valid price.');
      return;
    }
    const compareValue = form.elements.compare_at_price.value.trim();
    const compare = compareValue ? parsePriceToMinor(compareValue) : null;
    if (compareValue && compare === null) {
      showError('Enter a valid compare-at price.');
      return;
    }

    const images = [...imageList.querySelectorAll('.image-row')].map((row, index) => ({
      url: row.querySelector('[data-image-url]').value.trim(),
      alt: row.querySelector('[data-image-alt]').value.trim(),
      is_primary: row.querySelector('[data-image-primary]').checked,
      sort_order: index
    }));
    if (images.some((image) => !image.url)) {
      showError('Every image needs a URL. Remove empty rows first.');
      return;
    }

    const variants = [...variantList.querySelectorAll('.variant-row')].map((row, index) => {
      const variantId = row.dataset.variantId || null;
      const existing = variantId ? existingVariants.get(variantId) : null;
      const variantPrice = parsePriceToMinor(row.querySelector('[data-variant-price]').value);
      const variantCompareValue = row.querySelector('[data-variant-compare]').value.trim();
      return {
        id: variantId,
        name: row.querySelector('[data-variant-name]').value.trim(),
        sku: row.querySelector('[data-variant-sku]').value.trim(),
        price_minor: variantPrice ?? 0,
        compare_at_price_minor: variantCompareValue ? parsePriceToMinor(variantCompareValue) : null,
        is_active: row.querySelector('[data-variant-active]').checked,
        sort_order: index,
        options: existing?.options ?? {}
      };
    });
    if (variants.some((variant) => !variant.name || !variant.sku)) {
      showError('Every option needs a name and SKU.');
      return;
    }

    const payload = {
      name: form.elements.name.value.trim(),
      sku: form.elements.sku.value.trim(),
      slug: form.elements.slug.value.trim(),
      brand: form.elements.brand.value.trim(),
      short_description: form.elements.short_description.value.trim(),
      description: form.elements.description.value,
      price_minor: price,
      compare_at_price_minor: compare,
      weight_grams: form.elements.weight_grams.value ? Number(form.elements.weight_grams.value) : null,
      status: form.elements.status.value,
      is_featured: form.elements.is_featured.checked,
      is_best_seller: form.elements.is_best_seller.checked,
      is_new_arrival: form.elements.is_new_arrival.checked,
      meta_title: form.elements.meta_title.value.trim(),
      meta_description: form.elements.meta_description.value.trim(),
      images,
      variants,
      category_ids: [...form.querySelectorAll('[data-category]:checked')].map((input) => input.value)
    };

    const button = view.querySelector('#save-product');
    setBusy(button, true, 'Saving…');
    try {
      if (isNew) {
        const result = await adminApi('/products', { method: 'POST', body: payload });
        toast('Product created.', 'success');
        context.navigate(`/products/${result.product.id}`);
      } else {
        await adminApi(`/products/${id}`, { method: 'PATCH', body: payload });
        toast('Product saved.', 'success');
        context.refresh();
      }
    } catch (error) {
      showError(error.message);
      setBusy(button, false);
    }
  });
}
