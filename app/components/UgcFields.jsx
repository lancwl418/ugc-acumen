// app/components/UgcFields.jsx
// Shared bits for the UGC admin pages: category options, placeholder pixel,
// and the Linked Products multi-select (Combobox search + Tag chips).
import { useState } from "react";
import { BlockStack, InlineStack, Tag, Combobox, Listbox, AutoSelection } from "@shopify/polaris";

export const CATEGORY_OPTIONS = [
  { label: "Driving Safety", value: "driving" },
  { label: "Towing & Camping", value: "towing" },
  { label: "Off-road & Overland", value: "offroad" },
  { label: "Fleet & Commercial", value: "fleet" },
  { label: "UTV & Utility", value: "utv" },
  { label: "Marine Life", value: "marine" },
];

export const categoryLabel = (id) =>
  CATEGORY_OPTIONS.find((c) => c.value === id)?.label || id || "Uncategorized";

export const TINY =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

/** 多选产品：Combobox 搜索 + Tag 展示已选 */
export function ProductMultiSelect({ products, value, onChange }) {
  const [input, setInput] = useState("");
  const list = Array.isArray(products) ? products : [];
  const titleOf = (h) => list.find((p) => p.handle === h)?.title || h;
  const selected = Array.isArray(value) ? value : [];

  const q = input.trim().toLowerCase();
  const options = q
    ? list.filter((p) => p.title.toLowerCase().includes(q) || p.handle.includes(q))
    : list;

  const toggle = (handle) => {
    if (selected.includes(handle)) onChange(selected.filter((h) => h !== handle));
    else onChange([...selected, handle]);
    setInput("");
  };

  return (
    <BlockStack gap="150">
      <Combobox
        allowMultiple
        activator={
          <Combobox.TextField
            label="Linked Products"
            value={input}
            onChange={setInput}
            placeholder={list.length ? "Search products…" : "No products synced yet"}
            autoComplete="off"
            disabled={list.length === 0}
          />
        }
      >
        {options.length > 0 ? (
          <Listbox autoSelection={AutoSelection.None} onSelect={toggle}>
            {options.map((p) => (
              <Listbox.Option
                key={p.handle}
                value={p.handle}
                selected={selected.includes(p.handle)}
                accessibilityLabel={p.title}
              >
                {p.title}
              </Listbox.Option>
            ))}
          </Listbox>
        ) : null}
      </Combobox>
      {selected.length > 0 && (
        <InlineStack gap="100" wrap>
          {selected.map((h) => (
            <Tag key={h} onRemove={() => toggle(h)}>{titleOf(h)}</Tag>
          ))}
        </InlineStack>
      )}
    </BlockStack>
  );
}
