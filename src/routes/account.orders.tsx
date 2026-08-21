import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrderCard } from "@/components/account/OrderCard";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type TranslationKey } from "@/lib/i18n";
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

type QuickFilter = "all" | "awaiting" | "paid" | "production";

const QUICK_FILTERS: { value: QuickFilter; labelKey: TranslationKey }[] = [
  { value: "all", labelKey: "account.filters.all" },
  { value: "awaiting", labelKey: "account.filters.awaiting" },
  { value: "paid", labelKey: "account.filters.paid" },
  { value: "production", labelKey: "account.filters.production" },
];

function resolveFilter(quick: QuickFilter): { payment: string; fulfilment: string } {
  if (quick === "awaiting") return { payment: "pending", fulfilment: "all" };
  if (quick === "paid") return { payment: "paid", fulfilment: "all" };
  if (quick === "production") return { payment: "all", fulfilment: "in_production" };
  return { payment: "all", fulfilment: "all" };
}

function OrdersTab() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [quick, setQuick] = useState<QuickFilter>("all");
  const [search, setSearch] = useState("");
  const [delivery, setDelivery] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "amount">("newest");
  const [showMore, setShowMore] = useState(false);
  const [page, setPage] = useState(1);

  const filters = useMemo(() => {
    const { payment, fulfilment } = resolveFilter(quick);
    return { search, payment, fulfilment, delivery, sort, page, pageSize: PAGE_SIZE };
  }, [quick, search, delivery, sort, page]);

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
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={quick === filter.value}
            onClick={() => {
              setQuick(filter.value);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              quick === filter.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(filter.labelKey)}
          </button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-expanded={showMore}
          onClick={() => setShowMore((value) => !value)}
        >
          <SlidersHorizontal className="mr-1.5 size-3.5" />
          {t("account.moreFilters")}
        </Button>
      </div>

      {showMore ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={t("account.searchPlaceholder")}
                className="h-9 pl-8"
                aria-label={t("account.searchPlaceholder")}
              />
            </div>
            <select
              aria-label={t("account.filterDelivery")}
              value={delivery}
              onChange={(event) => {
                setDelivery(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">{t("account.filterDelivery")}</option>
              <option value="digital">{t("account.digital")}</option>
              <option value="print">{t("account.printed")}</option>
            </select>
            <select
              aria-label={t("account.sort")}
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as "newest" | "oldest" | "amount");
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="newest">{t("account.sortNewest")}</option>
              <option value="oldest">{t("account.sortOldest")}</option>
              <option value="amount">{t("account.sortAmount")}</option>
            </select>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (data?.rows ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">{t("account.noResults")}</CardContent>
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
