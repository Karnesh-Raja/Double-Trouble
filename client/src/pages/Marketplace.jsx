import { Store } from 'lucide-react';
import { useAppData } from '../hooks/useAppData';
import ListingCard from '../components/ListingCard';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';

export default function Marketplace() {
  const { marketplace, marketSummary, insight, selectedId, errors, refreshAll } = useAppData();
  // The backend already returns lots most urgent first, so the page does not sort or price anything.
  return (
    <div>
      <h1 className="text-2xl font-bold">Retailer marketplace</h1>
      <p className="mb-4 text-sm text-slate-600">Discounted produce listed and priced automatically by the backend when shelf life drops. Most urgent first.</p>
      {marketSummary && marketSummary.activeListings > 0 && (
        <section aria-label="Estimated loss avoided" className="mb-4 grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-3">
          <div><p className="text-xs text-emerald-800">Estimated loss avoided</p><p className="text-2xl font-extrabold text-emerald-800">{marketSummary.lossAvoided}</p></div>
          <div><p className="text-xs text-slate-600">Potential loss without action</p><p className="text-lg font-semibold text-slate-800">{marketSummary.potentialLoss}</p></div>
          <div><p className="text-xs text-slate-600">Still lost after liquidation</p><p className="text-lg font-semibold text-slate-800">{marketSummary.residualLoss}</p></div>
          {marketSummary.sellThroughRate != null && <p className="text-xs text-slate-600 sm:col-span-3">Estimate across {marketSummary.activeListings} active lot(s), assuming {Math.round(marketSummary.sellThroughRate * 100)}% of discounted stock sells.</p>}
        </section>
      )}
      {errors.marketplace && !marketplace ? <ErrorState title="Marketplace unavailable" error={errors.marketplace} onRetry={refreshAll} />
        : marketplace === null ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div>
        : !marketplace.length ? <div className="rounded-lg border border-slate-200 bg-white"><EmptyState icon={Store} title="No listings yet" hint="Listings appear automatically when a shipment's risk rises above LOW. Try the temperature spike on the dashboard." /></div>
        : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{marketplace.map((l) => <ListingCard key={l.id} l={l} message={l.shipmentId === selectedId ? insight?.sections?.retailer : null} />)}</div>}
    </div>
  );
}
