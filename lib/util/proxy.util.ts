/**
 * 增加 typeorm tracing 功能
 * Created by Rain on 2021/7/6
 */
import { FORMAT_TEXT_MAP, Span, Tags } from 'opentracing';
import { Connection, Repository, SelectQueryBuilder } from 'typeorm';

import { optionalRequire } from './optional-require';

const { AsyncContext, TRACER_CARRIER_INFO, TracingModule } = optionalRequire(
  '@donews/nestjs-tracing',
  () => require('@donews/nestjs-tracing'),
);

export class ProxyUtil {
  static proxyConn(conn: Connection): Connection {
    if (!AsyncContext || !TracingModule || !TRACER_CARRIER_INFO) {
      return conn;
    }

    const queryOriginal = conn.query;

    conn['query'] = function (...args) {
      let context: any;
      try {
        context = AsyncContext.getInstance().get(TRACER_CARRIER_INFO);
      } catch (err) {
        return queryOriginal.apply(conn, args);
      }

      if (!context) {
        context = {};
        AsyncContext.getInstance().set(TRACER_CARRIER_INFO, context);
      }

      const tracer = TracingModule.tracer;
      const ctx = tracer.extract(FORMAT_TEXT_MAP, context);

      let span: Span;
      if (ctx) {
        span = tracer.startSpan('query', { childOf: ctx });
      } else {
        span = tracer.startSpan('query');
      }

      const result = queryOriginal.apply(conn, args);
      if (result.then) {
        result
          .then(() => {
            tracer.inject(span, FORMAT_TEXT_MAP, context);
            span.finish();
          })
          .catch(() => {
            tracer.inject(span, FORMAT_TEXT_MAP, context);
            span.setTag(Tags.ERROR, true);
            span.finish();
          });
      }
      return result;
    };

    const getRepositoryOriginal = conn.getRepository;
    conn.getRepository = function <Entity>(...args): Repository<Entity> {
      const repository = getRepositoryOriginal.apply(
        conn,
        args as any,
      ) as Repository<Entity>;

      if (conn['proxy'] == true) {
        return repository;
      }

      const createQueryBuilderOriginal = conn.createQueryBuilder;
      conn.createQueryBuilder = function (...args): SelectQueryBuilder<any> {
        const queryBuilder = createQueryBuilderOriginal.apply(
          conn,
          args as any,
        ) as SelectQueryBuilder<any>;

        const propertyList = ['stream', 'executeCountQuery', 'loadRawResults'];

        for (const property of propertyList) {
          proxy(queryBuilder, property);
        }

        return queryBuilder;

        function proxy(
          queryBuilder: SelectQueryBuilder<any>,
          property: string,
        ) {
          const original = queryBuilder[property];

          queryBuilder[property] = function (...args: any) {
            let context: any;
            try {
              context = AsyncContext.getInstance().get(TRACER_CARRIER_INFO);
            } catch (err) {
              return original.apply(queryBuilder, args);
            }

            if (!context) {
              context = {};
              AsyncContext.getInstance().set(TRACER_CARRIER_INFO, context);
            }

            const tracer = TracingModule.tracer;
            const ctx = tracer.extract(FORMAT_TEXT_MAP, context);

            let span: Span;
            if (ctx) {
              span = tracer.startSpan('query', { childOf: ctx });
            } else {
              span = tracer.startSpan('query');
            }

            span.setTag('property', property);
            span.setTag('sql', queryBuilder.getSql());

            const result = original.apply(queryBuilder, args);
            if (result.then) {
              result
                .then(() => {
                  tracer.inject(span, FORMAT_TEXT_MAP, context);
                  span.finish();
                })
                .catch(() => {
                  tracer.inject(span, FORMAT_TEXT_MAP, context);
                  span.setTag(Tags.ERROR, true);
                  span.finish();
                });
            } else {
              span.finish();
            }
            return result;
          };
        }
      };

      conn['proxy'] = true;
      return repository;
    };

    return conn;
  }
}
