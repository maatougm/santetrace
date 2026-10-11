import { DocumentReviewView } from "@/components/doctor/review/DocumentReviewView";

export default async function DocumentReviewPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id, documentId } = await params;
  return <DocumentReviewView patientId={id} documentId={documentId} />;
}
