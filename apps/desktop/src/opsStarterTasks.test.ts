import { addDocumentStarterTasks } from "./opsStarterTasks";
import { defaultOpsState } from "./state/opsStore";

test("starter tasks are explicit scaffolds and repeated clicks do not duplicate work", () => {
  const initial = defaultOpsState();
  const prd = addDocumentStarterTasks(initial, "prd");
  expect(prd.cards.length - initial.cards.length).toBe(2);
  expect(prd.cards.at(-1)?.lastNote).toContain("Starter from PRD");
  expect(addDocumentStarterTasks(prd, "prd")).toBe(prd);
  const both = addDocumentStarterTasks(prd, "tdd");
  expect(both.cards.length - initial.cards.length).toBe(4);
  expect(addDocumentStarterTasks(both, "tdd")).toBe(both);
});
