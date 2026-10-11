"use client";

import { useCallback } from "react";
import type { DoctorProfile } from "@/contracts/patient-platform";
import { listDoctors } from "@/lib/client/grants-api";
import { usePatientRuntime } from "../PatientRuntime";
import { useFencedResource } from "./useFencedResource";

const NO_DOCTORS: readonly DoctorProfile[] = [];

/**
 * Directory names for validator lines and recipients. A failure leaves the
 * list empty, so callers fall back to their generic wording ("votre médecin").
 */
export function useDoctorDirectory(): readonly DoctorProfile[] {
  const { data, scope } = usePatientRuntime();
  const load = useCallback((signal: AbortSignal) => listDoctors({ signal }).then((r) => r.doctors), []);
  const directory = useFencedResource(data.fence, scope ? `doctors:${scope.actorId}` : null, load);
  return directory.value ?? NO_DOCTORS;
}
