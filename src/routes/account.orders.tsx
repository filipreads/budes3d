import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrderCard } from "@/components/account/OrderCard";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { listAccountOrders, type AccountOrder } from "@/lib/account.functions";

export const Route = createFileRoute("/account/orders")({
  head: () => ({
    meta: [
      { title: "Your orders — Relievo Studio" },
      { name: "description", content: "Search, filter and track every 3D portrait order you placed." },
      { property: "og:title", content: "Your orders — Relievo Studio" },
      { property: "og:description", content: "Order status, invoices, share links and downloads." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrdersTab,
});

const PAGE_SIZE = 10;

function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function OrdersTab() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [payment, setPayment] = useState("all");
  const [fulfilment, setFulfilment] = useState("all");
  const [delivery, setDelivery] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "amount">("newest");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ search, payment, fulfilment, delivery, sort, page, pageSize: PAGE_SIZE }),
    [search, payment, fulfilment, delivery, sort, page],
  );

  const queryKey = ["account-orders", user?.id, filters] as const;
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listAccountOrders({ data: filters }),
    enabled: Boolean(user),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  function onShareChange(orderId: string, enabled: boolean, token: string | null) {
    queryClient.setQueryData(queryKey, (current: { rows: AccountOrder[]; total: number } | undefined) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.id === orderId ? { ...row, share_enabled: enabled, share_token: token } : row,
            ),
          }
        : current,
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t("account.searchPlaceholder")}
          className="h-9 w-full sm:w-56"
          aria-label={t("account.searchPlaceholder")}
        />
        <Select
          label={t("account.filterPayment")}
          value={payment}
          onChange={(value) => {
            setPayment(value);
            setPage(1);
          }}
          options={[
            { value: "all", label: t("account.filterPayment") },
            { value: "pending", label: t("status.pending") },
            { value: "paid", label: t("status.paid") },
            { value: "refunded", label: t("status.refunded") },
          ]}
        />
        <Select
          label={t("account.filterFulfilment")}
          value={fulfilment}
          onChange={(value) => {
            setFulfilment(value);
            setPage(1);
          }}
          options={[
            { value: "all", label: t("account.filterFulfilment") },
            { value: "new", label: t("status.new") },
            { value: "in_production", label: t("status.in_production") },
            { value: "shipped", label: t("status.shipped") },
            { value: "delivered", label: t("status.delivered") },
            { value: "cancelled", label: t("status.cancelled") },
          ]}
        />
        <Select
          label={t("account.filterDelivery")}
          value={delivery}
          onChange={(value) => {
            setDelivery(value);
            setPage(1);
          }}
          options={[
            { value: "all", label: t("account.filterDelivery") },
            { value: "digital", label: t("account.digital") },
            { value: "print", label: t("account.printed") },
          ]}
        />
        <Select
          label={t("account.sort")}
          value={sort}
          onChange={(value) => {
            setSort(value as "newest" | "oldest" | "amount");
            setPage(1);
          }}
          options={[
            { value: "newest", label: t("account.sortNewest") },
            { value: "oldest", label: t("account.sortOldest") },
            { value: "amount", label: t("account.sortAmount") },
          ]}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (data?.rows ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">{t("account.noResults")}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(data?.rows ?? []).map((order) => (
            <OrderCard key={order.id} order={order} onShareChange={onShareChange} />
          ))}
        </div>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            {t("account.prev")}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t("account.pageOf", { page: String(page), pages: String(pages) })}
          </p>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
            {t("account.next")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
