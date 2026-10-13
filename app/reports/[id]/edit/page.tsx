"use client";
import { useParams } from "next/navigation";
import ReportForm from "../../../../components/reports/ReportForm";
export default function EditDailyReportPage() {
  const { id } = useParams<{ id: string }>();
  return <ReportForm key={id} reportId={id} />;
}
