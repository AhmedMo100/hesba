/**
 * Pool starvation (production readiness audit): a query on the OUTER Prisma client inside a
 * `withTenant` transaction needs a second pool connection while the transaction holds the first.
 * Under concurrent requests every request then waits for a connection the others hold, and all of
 * them fail with "Unable to start a transaction in the given time" (measured: 50 parallel
 * GET /api/products → 50 × 500 after ~20 s). The products list must survive a burst.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import * as products from "@/app/api/products/route";
import { SaleFixtures } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
type Handler = (req: Request, ctx: never) => Promise<Response>;

describe("connection pool under a burst of requests", () => {
  let token = "";
  beforeAll(async () => {
    await f.setup();
    await f.product(A, { name: "صنف ضغط", sell: 1000 });
    token = (await createSession(A.userId, A.storeId)).rawToken;
  });
  afterAll(async () => {
    await f.teardown();
  });

  it("40 concurrent product lists all answer 200 (no transaction waits on a second connection)", async () => {
    const statuses = await Promise.all(
      Array.from({ length: 40 }, async () => {
        const res = await (products.GET as Handler)(
          new Request("http://localhost:3000/api/products", {
            headers: { cookie: `hesba_session=${token}` },
          }),
          {} as never,
        );
        return res.status;
      }),
    );
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
  }, 60_000);
});
