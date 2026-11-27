"use server";

import { writeForRequest } from "@/db/http";
import { saveRevisionFile } from "@/db/engineering/design";

export async function attachRevisionFile(form: FormData) {
  return writeForRequest(db => saveRevisionFile(db, form));
}
