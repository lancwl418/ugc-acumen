import { useState, useRef, useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Popover, TextField, ActionList, Spinner, Text, Button,
} from "@shopify/polaris";

export function CustomerSearchPopover({ username, onLink }) {
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState("");
  const searchFetcher = useFetcher();
  const timerRef = useRef(null);

  const customers = searchFetcher.data?.customers || [];
  const isLoading = searchFetcher.state === "loading";

  const handleQueryChange = useCallback((value) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    if (value.length >= 2) {
      timerRef.current = setTimeout(() => {
        searchFetcher.load(`/api/customer-search?q=${encodeURIComponent(value)}`);
      }, 300);
    }
  }, []);

  const handleClose = useCallback(() => {
    setActive(false);
    setQuery("");
  }, []);

  return (
    <Popover
      active={active}
      activator={
        <Button variant="plain" onClick={() => setActive(true)}>
          Link Customer
        </Button>
      }
      onClose={handleClose}
    >
      <Popover.Pane>
        <div style={{ padding: 12, minWidth: 280 }}>
          <TextField
            label="Search customer"
            labelHidden
            value={query}
            onChange={handleQueryChange}
            autoComplete="off"
            placeholder="Name or email..."
            autoFocus
          />
          {isLoading && (
            <div style={{ padding: 8, textAlign: "center" }}>
              <Spinner size="small" />
            </div>
          )}
          {customers.length > 0 && (
            <ActionList
              items={customers.map((c) => ({
                content: `${c.displayName}${c.email ? ` (${c.email})` : ""}`,
                onAction: () => {
                  onLink(username, c);
                  handleClose();
                },
              }))}
            />
          )}
          {query.length >= 2 && !isLoading && customers.length === 0 && searchFetcher.data && (
            <Text tone="subdued" as="p" variant="bodySm">
              No customers found
            </Text>
          )}
        </div>
      </Popover.Pane>
    </Popover>
  );
}
