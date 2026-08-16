const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      if (!env.DB) return page('Erro', '<p>Banco DB não conectado.</p>', 500);
      if (!env.TEACHER_PASSWORD || !env.AUTH_SECRET) return page('Erro', '<p>Secrets não configurados.</p>', 500);

      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      if (path === '/manifest.webmanifest') return appManifest();
      if (path === '/sw.js') return appServiceWorker();
      if (path === '/app-icon-192.png') return appIconResponse(192);
      if (path === '/app-icon-512.png') return appIconResponse(512);

      if (path === '/login') return method === 'POST' ? loginPost(request, env) : page('Login', loginForm());
      if (path === '/logout') return logout();

      let publicPrintMatch = path.match(/^\/e\/([^/]+)\/imprimir$/);
      if (publicPrintMatch) {
        return studentPrintableExam(request, env, publicPrintMatch[1]);
      }

      if (path.startsWith('/p/')) return publicExam(request, env, path.split('/')[2], '/p');
      if (path.startsWith('/e/')) return publicExam(request, env, path.split('/')[2], '/e');

      let m = path.match(/^\/imagem\/q\/(\d+)$/);
      if (m) return questionImageResponse(env, Number(m[1]));

      if (!(await isTeacher(request, env))) return redirect('/login');

      if (path === '/') return dashboard(env, url.searchParams.get('msg') || '');
      if (path === '/banco') return method === 'POST' ? addQuestion(request, env) : bank(env);
      if (path === '/banco/importar' && method === 'POST') return importQuestions(request, env);
      if (path === '/banco/limpar-repetitivas') return method === 'POST'
        ? cleanupRepetitiveQuestions(request, env)
        : cleanupRepetitiveQuestionsPage(env);

      m = path.match(/^\/banco\/imagem\/(\d+)$/);
      if (m) return method === 'POST'
        ? saveQuestionImage(request, env, Number(m[1]))
        : questionImageEditor(env, Number(m[1]));
      if (path === '/api/questoes') return manualQuestionsApi(url, env);
      if (path === '/provas/lote') return examBatchPage(url, env, request.url);
      if (path === '/provas/nova') return method === 'POST' ? createExam(request, env) : newExam(env);
      if (path === '/provas/zerar') return method === 'POST' ? resetCreatedExams(request, env) : resetCreatedExamsPage(env);
      if (path === '/notas/recalcular-antigas') return method === 'POST'
        ? recalculateLegacyGrades(request, env)
        : recalculateLegacyGradesPage(env);
      if (path === '/resultados') return globalResults(env);
      if (path === '/medias-finais') return finalAveragesPage(url, env);
      if (path === '/alunos') return studentResultsHub(url, env);
      if (path === '/caderno/planilha') return gradebookSpreadsheet(url, env);
      if (path === '/caderno') return gradebookRco(env);

      m = path.match(/^\/provas\/(\d+)\/imprimir$/);
      if (m) return teacherPrintableExam(env, Number(m[1]));

      m = path.match(/^\/provas\/(\d+)\/recuperacao\/criar$/);
      if (m && method === 'POST') {
        return createRecoveryForExistingExam(env, Number(m[1]));
      }

      m = path.match(/^\/provas\/(\d+)$/);
      if (m) return examDetail(env, Number(m[1]), url.origin);

      m = path.match(/^\/provas\/(\d+)\/toggle$/);
      if (m && method === 'POST') return toggleExam(env, Number(m[1]));

      m = path.match(/^\/provas\/(\d+)\/excluir$/);
      if (m && method === 'POST') return deleteExam(env, Number(m[1]));

      m = path.match(/^\/provas\/(\d+)\/resultados$/);
      if (m) return examResults(env, Number(m[1]));

      m = path.match(/^\/provas\/(\d+)\/resultados\.csv$/);
      if (m) return resultsCsv(env, Number(m[1]));

      return page('Não encontrado', '<p>Página não encontrada.</p>', 404);
    } catch (e) {
      console.error(e);
      return page('Erro no sistema', `<p>${esc(e.message || String(e))}</p>`, 500);
    }
  }
};


const APP_ICON_192 = "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAJe0lEQVR42u3du44cxxXG8a/aBAgrEMAH8ILcwIntQBRvIKxgB6YfQKlASRRlyoHhULYC0bIjwaFA6kJSDPwIvgQ2sWtIzngnnQjKxEgZY8LBOOjZ3p6e7pmq6qrq6t7/SbRL7bCndn48faa75hzzoze+l+aqwujgW1P96bz2tWQaP7//kPrPS2bdQ3wPcfDXNo7ofoiVh5hAC288xHgvvP0h8/1n6/Ks1i68cQjjsvACPejx1iOpQA96vPXUAKEHPV4LL9CDHm89kgr0oMf0WHiBHvT0WXiBHvT0WXiBHvT0WXiBHvT0WXiBHvR4L7yqgdCDHh89JSD0oMdTT6MGQg963PSU14HQgx5PPfu3MtCDHi89Zv86EHrQ46OnrIHQgx5PPY0aCD3ocdOjlXth6EGPgx4t3wtDD3rc9EjzAj3o8dZT1UDoQY+Pnv1bGehBj5cetewHQg96rPWouR8IPehx0bO8Hwg96HHUI9WKaPSgx1XPQRGNHvR46FlkIPSgx0+PpCPT0PPVh9saYex88t9R65GR2Xrn2Rj1fHX1hCYXO9eejkuPNN8HNBI9XW62jh0do5hnz1+0S7r+ZBR6pDIDjUHP11ePTwONPaad608y1yPJbF3+LnM9X//h+FTR2GDa+fRxtnpk6oDy03MI6XQy+uxxhnpqGSgzPYecThej2eePstITosFUTD1bx44ecj2NX8Ler1/JSo8ks/Xud/noqdMR0Z2NZl88zEFPvwZT6BkiGy1S0Xsnc9Aj/wZT6MnE0KB65NlgKo4eKh7Xqmjvyslh9cinwVQ0PcjwSEV7V14dUI97gyn0ZGjoV68OpUduDabQk6+hU4PokUODKfRkbujdU+n1GNsGU+gZi6G0euwaTEV7x04Ej73Lp1PqqV8HSn2PnfQT6fpQSj3VvbDU97nQE/FEdvl0Mj1a12AKPeM19M6ZNHq6G0zF21tIpIkketTeYCrm7jDST5oktHvpTAI9amkwRe6ZTkTXs9JgKvK+ZtJP2iR0Nrae5QZTMT9TQQxaD8XSI9U2lMX+RA7pZ4Ak9PbZqHoOiugUn0QmsnhrFlKPlpsrRPwsKelnsCT01rl4eiQV5B5yj7eeakMZetDjo0dtXVrpoTG12H3zXCQ9WtlUH6V/DwXQsGVQPD3atKEsSPcnIpOzWHg96zeUoWdiEV7PmomFgfoWEpPWo46JhSH7FlIAZXE16OL5GHrUtqEsQs9UIq96KJie1Q1l6EGPW7PYAj3o8dZTvw6EHvQ466k2lEXuFU9kdT0onB67BlPoQU/3K16gBz3eerShwRR6piYosB6zrsGUgszIIbKKwHq6G0yhBz0WetTeYErh5nMROZ7FgulRS4Mp9KDHWo+a+4EUYzYgkdmJLJweGR0ZkZ4X/5ufuPg06m/35Zd+8M3tn2b+HPLRU7sORO4h97jr6dxQFmyqLZFjDRRMj1o3lKHnEGAKo0erG8qiTNQmJqqnuaEMPehx0qP6zVT0oMdVz8HEQvSgx0NPWQPF0cNt+azfjoXRI6MjkfQMmInufPzjnxz/4bCvUQ7PIYEe+U8szFUPkVKPPCcWogc9qgBF0oOj7CK8HveJhQ56KKKzzUPB9MhtYiF60LOCpEAPerz1yHZioYceaqBsK6FweuwmFqIHPZ1I5kemp+fC77/1e+AvXnn5L787MZnnkECPOhpMBdFDJZRpDRRQj9ZNLOyph7NYtorC6emeWIge9FjoUfvEQvSgx06PWiYWomeygsLrMc2JhQH1sB8o92o6gJ7liYXoQY+jHrUNW0EPemz1SOVHm6elhx2JyfSouR+I3DPxCKxneT9QWD28HTsEeiQV0fSQjbIvg3rrUdfEQvSgx0aPWicWogc9lnq0uqEsmB5qoGzLoHB6mhvK0IMeJz1LDaZC6+FElu1ZLJieqgZCD3p89JQ1UBw9nMXylRRMT9lcIYqeAf1470cu4/WfH7v2my30WL7ixcT0ECn1yGFiIXrQ4z+x0EMPN1azrqbD6LGbWIge9PhPLEQPevwnFqIHPZtOUEUsPdTS2UV4PXYNptAztTwUTI8kc+KDJ3H0zCX9+7c/k7R17Cgv3FDx7PkLSRf+eieGHm1oMNVPD3lo2rlntQZCD3rc9HQ3mELPNBUF1lO/DhRDz7x+GiaGKoDi6amGrcTRY7Rz7Smv4uBx4W93IulRs8FUUD3EhM9c5UPMytRm9OQSp//z5/q39157v38FHVyP1OxQFl7PzvUnlEE99bT+iWUB9Mu//yueHq3dUBYi93BrLIQeb0PrXosQeg4mFkbVQxLqr8fVUDP9xNGj/QuJkXMPJVEIPf55KJqe1g1lMfTMdz59TBJKfPlnkX5i6lFXl9awenhFh3sHH1ePWru0RtFjtPMZSSht+omvR7WbqXH1UAhNL/eUDykS6pnPPn9EEloTNlcL1//MIv38459p9KjeYCq2nvI/GOrjIzc9BzVQGj2rqyXsldjoWTmRxdWzqIGS6jHz2RcPUeJqyPJe2FL6ia9HRmb76oOUeqov9947KbZLh33nlVzPUoOplHpkNLvxkBPZ2PXIYWJhUD3l3zm78QBDo9Yj24mFEfQs8tBNDI1Yj93Ewmh6ypjdvI+hkerR5omFkfWU385uLQzByJJOJnq0YWJhEj2LC4y37nN9yD7xZKJH6yYWJtSzOJd9eQ9D49IjI7P90f0c9CxdIrp8uvyCq0Qb6AytR+0TCwfVI6PZ7buNkz0VT556JJntj+5lpUfa71tttHvpTPV/DmE2qv/jSba/x0mPJLP9x3t56qkesnvp7GFj1KQj5alHZl4BylRP9fXu22cbv+WJYVo9WSf4TEVPPVUGyl1P9fO7b51r/e2PFFNXhRf704Ch9JSA7o5FT/0hu2+em96ZK2oXhBh6JJntP90dnZ7VjyLtXjw/SjHROs8l0mMagMapp+sQRmEusjffuK5ZuGJNlsxTj9TVoQw96LHQs2ZDGXrQs1mPOjaUoQc9VnrUtqEMPeix1bO6oQw96HHQozUNptCDno16OhtMoQc9NnrU2mAKPeix1NPSYAo96LHX06iB0IMeNz2qb6pHD3pc9VQ1EHrQ46Nn0WAKPejx0yOpQA96vPVow8RC9KBn0yEK9KDHW0/3xEL0oMfuEAV60GN6LLxAD3r6LLxAD3r6LLxAD3r6LLxAD3r6LLxAD3q8F762wRR60GNxiAI96AndYAo96LE+RIEe9PQ5RIEe9Hgfwhj9H9AYITy9Fe3VAAAAAElFTkSuQmCC";
const APP_ICON_512 = "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAIAAAB7GkOtAAAcJ0lEQVR42u3duY8k53nA4bfKKxAwDAt0ZgFekOtMMGxY4iEJcDALkPoXBFgXD0sOHApOLFJSqkwXddiWUgdOJDoRyV1j6cwkxUuBQ4uB4UxQSDhoBzM9U9V19kxPT9X3Pr9AEMjmbnE4/bz1de+8Xf3JX/9vxCbGq87/32bqAc02Uw9o/grzr2HgMgZ/i835A6rrvoYlfSmqhf/nONxlVOv/zpxuexlV6U/SiYdPXsM6vxTVDV1DTX/605/+9E+of0TU9Kc//elP/4T6Tw0A+tOf/vSnf6H6jw4A+tOf/vSnf7n6Dw8A+tOf/vSnf9H6DwwA+tOf/vSnf+n69w0A+tOf/vSnfwL9OwOA/vSnP/3pn0P/iE1Nf/rTn/70T6h/4wRAf/rTn/70z6T/dgDQn/70pz/9k+kfETX96U9/+tM/of6nu4DoT3/605/+6fTfvgREf/rTn/70T6b/6QCgP/3pT3/6p9M/ZqyCoD/96U9/+heof0ytgqA//elPf/qXqX+MroKgP/3pT3/6F6t/DK+CoD/96U9/+pesf3sA0J/+9Kc//dPoH32rIOhPf/rTn/7l6x+dVRD0pz/96U//FPpHexUE/elPf/rTP4v+UW1q+tOf/vSnf0L9o+/nAOhPf/rTn/7l698dAPSnP/3pT/8U+u8MAPrTn/70p38W/ZsDgP70pz/96Z9I/+hZB01/+tOf/vRPoH/sroOmP/3pT3/659A/ZqyCoD/96U9/+heof0ytgqA//elPf/qXqX+MroKgP/3pT3/6F6t/DK+CoD/96U9/+pesf1RDHwlJf/rTn/70L/1JWtOf/vSnP/0T6j86AOhPf/rTn/7l6j88AOhPf/rTn/5F6x/Ruw6a/vSnP/3pX7r+fScA+tOf/vSnfwL9q90BQH/605/+9M+hf/sEQH/605/+9E+jf2MA0J/+9Kc//TPpvx0A9Kc//elP/2T6R0RNf/rTn/70T6j/nFUQ9Kc//elP/wL1j6lVEPSnP/3pT/8y9R8dAPSnP/3pT/9y9R8eAPSnP/3pT/+i9R8YAPSnP/3pT//S9e8bAPSnP/3pT/8E+ncGAP3pT3/60z+H/u1toPSnP/3pT/80+jdOAPSnP/3pT/9M+m8HAP3pT3/60z+Z/hFR05/+9Kc//RPqv7MKgv70pz/96Z9F/2j8KSD605/+9Kd/Iv3PBwD96U9/+tM/l/6nA4D+9Kc//emfTv+YsQqC/vSnP/3pX6D+MbUKgv70pz/96V+m/jG6CoL+9Kc//elfrP7tAUB/+tOf/vRPo38MrIKgP/3pT3/6F65/9K2CoD/96U9/+pevf3RWQdCf/vSnP/1T6B/VpqY//elPf/on1D8GPhOY/vSnP/3pX7j+vQOA/vSnP/3pX77+3QFAf/rTn/70T6H/zgCgP/3pT3/6Z9E/etZB05/+9Kc//RPoH7vroOlPf/rTn/459I/WOmj605/+9Kd/Gv2juQqC/vSnP/3pn0f/OF8FQX/605/+9E+lf5yugqA//elPf/pn0z+qqOlPf/rTn/4J9Y+BVRD0pz/96U//wvWPiFv0p//kNTz4+p3QCjv5zq/pT/+Ra6huP/sB/el/+gDQZxkM332f/vSP2PQNAPqn0f/BC8RXnHzvffon1L/vBED/0vV/8MKjyNPwMHiP/kn07wwA+heqP/R1mWHw/ffoX7D+7QFA/+L0f/Ai93UNk4D+RejfGAD0L0j/g7t/++GHILjGPvjth4efBPQvRf/tAKB/EfofxH3WmwqzJsEP3qX/2vWPiOr2c7+h/9r1vwr9xDcPDjYG6L8q/aOaHAD0X7D+l3Of+Dr4PDj5wbv0X53+UycA+i9V/wcvPsJ9LW0SnLz0Lv1XpP/oAKD/Ir+xXt+Tfu7ryJPg5KV36L8K/YcHAP2X9421F/3c181OgosxQP+l6j8wAOi/sG+s178xl37ua1GT4OSH79B/sfr3DQD6L+kbC/0qZgzQf2n6dwYA/demP/e1iklw9+woQP9ledUYAPRfzDcW+lXoGHib/ovyajsA6L+Mbyz0q/wx8KO36b8Qr2r6r0j/2w8/RH8tuTnfovf/9i/pvxCvqtvP/4b+N/6NNYd+uKiw00DPUYD+x/xSVK0Phac//aVDngb2OwrQ/7j6R1wMAPovUX+v+WjtM2D8G/hiBtD/6PrH9iUg+t/AN9Yk/fhQSY2/InT3x7+i/5H1Pz0B0J/+0jFOA2NHga9+gv5H1j+i9R4A/W9ef6/5qOwZMPLt3T8D6H9t+kdEdfv5/6b/0b6x3PhLMf/lIPpfp/59JwD601+6/qPAyN89OwrQ/5r17wwA+t+E/l72Uc4ZMPvlIPpfi/7tAUD/G9KfBXIU6JkBX/kE/a9V/8YAoD/9pYXOAPpfi/7RtwuI/sfQ38s+0pynw/2vfJL+16R/RNT0vxH9Peelmc+LixlA/4PqH9Wmpj/9pRXMAPofWv/o+0Ew+tNfWt4M+JtP0v+w+ncHAP3pL61lBtD/SvrvDAD6019aywyg/1X1j/510PSnv7ToGUD/A+h/PgDoT39pRTPgMfpfXf9qdx00/ekvrWUG0P9q+seMVRD0p7+0yBnw/GP0v4r+MbUKgv70l1Y4A+g/Q/8YXQVBf/pLK5wB9J+nfwyvgqD/pS6D/tLRZwD9L6d/VEMfCUn/GZfRe/tPf+nIM+DiEED/ffSPGB8A9Ke/tJYZQP899R8dAPTfU39JN9j95x6n/176R2xq+l/1Mtz+Sws4BNB/X/0HTgD0H70ML/5Iy5wB/YcA+g/o3zcA6E9/qZgZQP9h/TsDgP776y9pUV3MAPqP6t8eAPSffxlu/6WlHgLoP1P/xgCg/9RlePFHWssMaL8QRP/Ba6jpT3+pwBnw7OP0H9c/Imr673EZktYU/cf0n7MKgv5u/6WVHgKeoP+I/jG1CoL+e3y3SVraDKD/+HXW9B+/DH/0U1pv9559gv4jl1HTf1/93f5LKzoE3Hv2CfoP/QM1/SXli/69A4D+bv+lwg4BzzxB/97fpab//C8W/aWVzgD6915DTf/e3+X1Fx/xRJKKaXsIoH/rwTX9Z/4ubv+llR8C6L/74Jr+3d/F7b9U4iHgSfrvPLim/9S/qdt/qZhDAP1bZtb03/k3feD2Xyr+EED/9ioI+p/+z8btv1T4IYD+7VUQ9D/T/8GLj3raSCUfAr78JP3Pq+k/cu/v9l9KcQhIqX+MrIKgv6QUZdU/hlZB5NTf6z9ShlqvAiXWP3pXQbj33/v8KGmpjX5wfGr92wMgt/5u/6Vch4D0+sfOKgj3/m7/pVyHgMT6R3MVBP0lKY/+cb4KIrn+Xv+RsnXvS59Krn9Um5r+BzszSlpqs38gIJH+EVHTX5IS6h+dnwPIqL/Xf6SctV4Fyqf/zgBIee/vox+lHI3+QEBG/aN/G2hu/SXlKqv+0bMNNJn+D17w+o+Ut/afBcqlf+xuA3Xv7/UfqdxGn93p9I/uKojk+ktKWUb9Y2cVBP0l0T+J/tFcBZFQ/+4bAF7/kcqu+xy/98VP59Q/zldBuPeXpFT6R9X7iWD0l0T/0vWPGB8AhetvLYSkvPqPDoDS9X/wwh3f8JLi9G2AfPoPD4CU9/7eAZYytM8zvWT9IzY1/SUpof59JwD6S1IC/TsDII/+/lCQpNz6twdAJv0ffN07wJIuuveFT2fTvzEA0t/7ewdYytPw8z2R/tsB4JUfSUqmf0TU9Jek/aAoQv85qyDoL4n+BeofU6sg6C+J/mXqPzoA6C9J5eo/PADoL0lF6z8wAErXv/tDAP4MqJStnk+G+fxnUunfNwDc+0tSAv07A4D+kpRD//YAoL8kpdG/sQ46j/6VhaCS6H++Dpr+kpRM/4io6S9JCfXfWQVBf0n0z6J/NN4Epr8k+ifS/3wA0F+SpvgpS//TAUB/SUqnf8xYBUF/SfQvUP+YWgVBf0n0L1P/GF0FQX9J9C9W/xheBUF/SfQvWf/qYgDk0d+mIEn7TYMy9Y++VRD0l0T/8vWPzioI+kuifwr9o9rU9JekhPrHwGcCl62/t4gl0T96BwD9JSUvhf7dAUB/SfRPof/OAKC/JPpn0T/610HTX5JK1z961kHTX5IS6B+766DpL0k59I95u4DK0t8PBEiif0RE3KJ/GX34f5tHv/Ce52xE/OuLf/qZj/+BL/JKv8j0P5r+MbULiP6S3PuXqX+M7gKivyT6F6t/VFHTX5IS6h8xPgDoLyl7xeo/OgDoL4n+5eofMbQOmv6S6F+0/gMngML196NhkugffQOA/pLon0D/zgCgvyT659C/PQCS6O+NAUn0bw0A+ktSJv23A4D+kpRM/4io6S9JCfWfswqC/pLoX6D+MbUKgv6SVKb+owOA/pJUrv7DA4D+klS0/gMDgP6SVLr+fQOA/pKUQP/OAKC/JOXQv70Omv6SlEb/xgkgj/6VlXCS6B/bAUB/SUqmf0Tcor9m9tnHPvqzrz3i6+CLTP8y9D9bBZFKf+8RSKL/2SoI+kvSvPFQlP4RUdNfkhLqH+OrIOgvSaXqHyOrIOgvSQXrH0OrIOgvSWXrH72rIOgvScXr3x4A9JekNPrHziqIFPobC5LofzEA6C9JyfSPiJr+kpRQ/6g2dT79bQSSRP/mOmj6S1Im/bsDgP6SlEL/nQFAf0nKon9zANBfkhLpfz4A6C9J89ktQf/YXQdNf0nKoX/MWAVBf0n0L1D/mFoFUaL+fhxMEv0vBgD9JSmZ/jG8CoL+kuhfsv5RDX0kJP0l0b9o/SPGBwD9JalQ/SPiFv01s1+++buPfe7dZV7bH/7+7/3XT//MF9kXmf570V3TX5IS6h/Ruw66cP39cIAk+veug6a/JCXQvzMA6C9JOfRvDwD6S1Ia/RsDII/+3haWRP+LAUB/SZqCojD9I6KmvyQl1H/OKgj6S6J/gfrH1CoI+ksyFMrUf3QA0F8S/cvVf3gA0F8S/YvWf2AA0F8S/UvXv28A0F8S/RPo3xkA9JdE/xz6twcA/SXRP43+jXXQefSvLAWSRP9NtV0FQX9JyqV/RNT0l6SE+u+sgqC/JPpn0T8abwLTX5IS6X8+AOgvSbn0Px0A9JekdPpHxC36a2affeyjP/vaI74Ovsj0L0P/mFoFQX9J9C9T/xhdBUF/SfQvVv8YXgVBf0n0L1n/xgDIo79NQZLofzEA6C9JyfSPzioI+kuifwr9o9rU9JekhPrHwGcCl62/t4gl0T96BwD9JSUvhf7dAUB/SfRPof/OAKC/JPpn0T961kHTX5IS6B+766DpL0k59I/WOmj6S1Ia/WPGKoji9PcDAZLofzEA6C9JyfSP0VUQ9JdE/2L1jypq+ktSQv0jJgcA/SXRv0T9pwYA/SVlr1j9RwcA/SXRv1z9I4bWQdNfEv2L1n/gBFC4/n40TBL9o28A0F8S/RPo3xkA9JdE/xz6twdAEv29MSCJ/q0BQH9JyqT/dgDQX5KS6R8RNf0lKaH+UcUt+mtmv3zzdx/73Ltrudq3Xvr4H//RR/xXE/1HHlNn098skHTZ8VCU/hFR01+SEuofg7uA6C9JRes/MADoL0ml6983AOgvSQn07wwA+ktSDv3b66CT6F/ZCCSJ/s110PSXpEz6bwcA/SUpmf4RUdNfkhLqH9XFm8D0l0T/RPrH9j0A+kvSJGhF6X86AOgvSen0jxmrIOgvif4F6h9TqyDoL4n+Zeofo6sg6C+J/sXqH8OrIErW/+Q7v975Kx/89kPf51Kqus/6p37+Wir92wMgz72/9UCSct/7twcA/SUpk/7RWQVBf0n0T6F/tFdB5NHfW8SSsusf1aamvyQl1D/6fg6A/pLoX77+EXGL/qd98NsPbz/80Hq/dR/6SPU///IXnsK+yJrT1J/8TqH/zgkgkf4n333fc0DSeU/94rVs+jcHgFd+JCmR/tGzDpr+kuifQP/YXQedR38/ECApt/4xYxVEIv1tBJIyNPeZXrr+MbUKomT9T77nfWBJERFP/eLVhPrH6CqIRPf+kpRN/xheBUF/SfQvWf+ohj4Skv6S6F+0/hHjA6Bw/Tcn33tv5y95H1gqu57PgTl/AyCZ/qMDoHT9PRMkpb33Hx0A9JdE/6L1j+hdB51H/2rWCVFSGfU/u7Pq33cCSKb/yfff86yQ0vbUy6+m1b8zAHLf+0tSHv3bA4D+4+dESWtu9vM6i/6NAZBYf68CSTnre/0nkf7VdhWEe39JyqV/RNyi/9BpcdWfECkdrcf/49tDf+uNv/r7hVzkjNd/0ukfVVSP/sPb9I+If/+7P9/5KwaAdGn6lzYGen4AuPX6T0b9o/Oh8Fnv/Ss/GiYdnv7mg5dzGnDvf/6AW/QfugyvAklXpH8hY2D09Z+8+sfwKoh0+p/84F3Pbema9D/gr3CQtq//pNZ/YAB45WfWjYNE/xXMgOFncXb9+wZAYv0dAqTjqH2z54CnXn6V/n0DwL2/pKN4faMzgP5nj6zpf9nzo6Sl1/v8pf/5I2v6N/MqkHS0W/UbOQQ8/fIr9G9vA6X/6K/gECAVc/tP//Y2UPq3f4WTlxwCpCPdpB/5EPD0y6/Qv/m4mv5zfgWHAKmE23/6tx9X07/71Tx56R3PH+k4t+dHOwQ8/W+v0H/nV6jpP+s/qkOAtPbbf/p3HlDTv/dXdgiQSmri9j+l/jFjFYR7f4cAqejb/6z6x9QqiNT6n/zwHTNAKkD/sdv/xPrH6CqI3Pf+PjxSKr7c+rcHAP07D3AIkIq9/U+vfwysgqD/RXf7ZoCkVUT/8Wuo6T9yDdU+NxqSlnb7T//xavpP6b+5+8O3zQAl7Dgf33iQ32WPF3/o37iGmv7j+lNAKif6t6+hpv8c/e/+yCFADgErv/2nf+caavpP3/tXZoC00Oh/lWuo6T9H/32//ySHgCP8ynOfffQfuIaa/vP17z0ESFpUu7f/9B++hpr+e937eyFIDgFLvv2n/17XUNM/9nzlxwyQGUD/AvSP1jpo+s+/htnfkZIZcBz9Dw9F6frH0CoI+o9fw90f/woHMgNu/CQxePtP/3nXUD36wlv0v9w13P/qJ7p///bDD2FCxXeJz3E8FP3TL/7Qf/Y1VI+++Bb9L30NZoCMgWPe9dP/sNdwi/4Hu4bG96gZoAydyj4yBg77gs/0S//03/MaLk4A9L/cNfQeApwDpMM2pP/F7T/997+Gmv5XvIahN4T9oSCJ/kvW/2wA0P+K13D3J2aARP+V6R+xqel/kGswAyT6r0v/6NkGSv/LXsPdn7xlBkj0X4v+nQFA/6tdgxkg0X8t+rcHAP0PcQ1mgET/VejfGAD0P9w13P1HM0Ci/9L13w4A+h/6GswAif4L1z8iavpf0zWYARL9l6x/VP0fCk//A1yDGSDRf8n6R0wOAPpfVv/tDHhz6HvdGJAmnw70v1avavpfn/6nDx6aAY4C0vizgP7X7VVN/2vV/+wc8E9mgET/xZlZ0/+69T/7c0GjM8AYUEL66X/jXtX0P4L+k+cARwG58af/8b2q7nzjTfofQf9m959/bOgf9ikCyqy/z/Y6slc1/Y+sf3g5SInpp/+ivKrpf2T9z2bAP79x6QOyVNiNP/1vyqvtS0D0P6L+zcu4/9zjIw/0ipBy0U//43pV0/8G9Z9zFHAa0Krpp/9i9Y+Imv43qP+cGRBeEVKJN/70X4JX1Z1vvkn/G9S/2fjLQeEVIZVKP/1vyKua/gvRP6q4+9Ppo4DTgBZOP/3Xon9EVHe++Qb9l6B/81e+/+wTk880pwGt666/n37636hXAwOA/jen//lfuGcMqGz66X/TXvUNAPovQP+YPQNMAi3Wffov3KvOAKD/YvQ/f8C9Z4wBlUU//ZfhVXsA0H95+l+cBmaPAZNAN+v+BP30X4xXjQFA/wXrf/7Ie888udeT1iTQMd2fpp/+S/JqOwDovwb9G6eBJ/d9GpsEulb3I+Lpl185xpOU/ofzqrrzzTfovy79zx9w78tPXuKJbRLosO6f0X+cJyn9D+pVdedbb9B/jfo3u9wkMA8UV1s08tTLr0ZsqqM9Sel/aK96BwD916T/QcaAeUD8/ekP+q9a/94TAP1XqX/zGu596VOHJcNUyGx9n/tB/wL07w4A+q9e/9aZ4NCTQDlru0//QvTfGQD0L0p/k0DX4D79y9G/OQDoX6z+O9dw74ufRpsG0f/Fq5NPEPoX49XpAKB/Fv13TwaGgZroz3iC0L8kr6o73/pP+ufUv/tb3PuCeZBE/Ncu9wShf2FeNQYA/XPr3/Pg8584+/xnoLlK6H/+2gG/K+hfnlfbAUB/+g/ov9dlDP+bruZT5+Z/Kar517D+LwX9i/Sqpj/96U9/+ifUv4qo6U9/+tOf/gn1j+rsQ+HpT3/605/+ufTfvgREf/rTn/70T6b/6ACgP/3pT3/6l6t/xKamP/3pT3/6J9R/4ARAf/rTn/70L13/vgFAf/rTn/70T6B/ZwDQn/70pz/9c+jfHgD0pz/96U//NPo3BgD96U9/+tM/k/7bAUB/+tOf/vRPpn9E1PSnP/3pT/+E+s9ZBUF/+tOf/vQvUP+YWgVBf/rTn/70L1P/0QFAf/rTn/70L1f/4QFAf/rTn/70L1r/gQFAf/rTn/70L13/vgFAf/rTn/70T6B/ZwDQn/70pz/9c+jfXgdNf/rTn/70T6N/4wRAf/rTn/70z6T/dgDQn/70pz/9k+kfETX96U9/+tM/of47qyDoT3/605/+WfSPxp8Coj/96U9/+ifS/3wA0J/+9Kc//XPpfzoA6E9/+tOf/un0jxmrIOhPf/rTn/4F6h9TqyDoT3/605/+Zeofo6sg6E9/+tOf/sXq3x4A9Kc//elP/zT6x8AqCPrTn/70p3/h+kffKgj605/+9Kd/+fpHZxUE/elPf/rTP4X+UW1q+tOf/vSnf0L9o/kmMP3pT3/60z+P/hcDgP70pz/96Z9K/7MBQH/605/+9M+mf0TU9Kc//elP/4T6R882UPrTn/70p38C/WN3Gyj96U9/+tM/h/4xsgqC/vSnP/3pX7D+MbQKgv70pz/96V+2/tG7CoL+9Kc//elfvP7RXQVBf/rTn/70z6B/VL2fCEZ/+tOf/vQvXf+I8QFAf/rTn/70L1T/0QFAf/rTn/70L1f/4QFAf/rTn/70L1r/iE1Nf/rTn/70T6h/3wmA/vSnP/3pn0D/zgCgP/3pT3/659C/PQDoT3/605/+afRvDAD605/+9Kd/Jv23A4D+9Kc//emfTP+IqOlPf/rTn/4J9Z+zCoL+9Kc//elfoP4xtQqC/vSnP/3pX6b+owOA/vSnP/3pX67+wwOA/vSnP/3pX7T+AwOA/vSnP/3pX7r+fQOA/vSnP/3pn0D/zgCgP/3pT3/659C/PQDoT3/605/+afRvrIOmP/3pT3/6Z9J/ewKgP/3pT3/6J9M/Imr605/+9Kd/Qv13VkHQn/70pz/9s+gfjTeB6U9/+tOf/on0Px8A9Kc//elP/1z6nw4A+tOf/vSnfzr9Y8YqCPrTn/70p3+ZT9Ka/vSnP/3pn1D/GF0FQX/605/+9C/5SVrTn/70pz/9E+rfGAD0pz/96U//TPpH3yoI+tOf/vSnf/n6R2cVBP3pT3/60z+F/lUV/w+1KGtcKf6nswAAAABJRU5ErkJggg==";

function base64Bytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function appIconResponse(size) {
  const encoded = Number(size) === 512 ? APP_ICON_512 : APP_ICON_192;

  return new Response(base64Bytes(encoded), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800'
    }
  });
}

function appManifest() {
  const manifest = {
    id: "/",
    name: "EducaFísica Avalia",
    short_name: "EF Avalia",
    description: "Provas, alunos, resultados, banco de questões e Caderno RCO em um único aplicativo.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f6fb",
    theme_color: "#10264a",
    prefer_related_applications: false,
    categories: ["education", "productivity", "sports"],
    icons: [
      {
        src: "/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable"
      },
      {
        src: "/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable"
      }
    ],
    shortcuts: [
      {
        name: "Criar prova",
        short_name: "Nova prova",
        url: "/provas/nova",
        icons: [{ src: "/app-icon-192.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Alunos e resultados",
        short_name: "Alunos",
        url: "/alunos",
        icons: [{ src: "/app-icon-192.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Caderno RCO",
        short_name: "RCO",
        url: "/caderno",
        icons: [{ src: "/app-icon-192.png", sizes: "192x192", type: "image/png" }]
      }
    ]
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

function appServiceWorker() {
  const js = `
    self.addEventListener('install', () => self.skipWaiting());

    self.addEventListener('activate', event => {
      event.waitUntil(self.clients.claim());
    });

    self.addEventListener('fetch', event => {
      if (event.request.method !== 'GET') return;

      if (event.request.mode === 'navigate') {
        event.respondWith(
          fetch(event.request).catch(() =>
            new Response(
              '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sem conexão</title><body style="font-family:Arial;background:#f3f6fb;color:#172033;padding:28px"><div style="max-width:440px;margin:60px auto;background:white;padding:24px;border-radius:20px"><h1>EducaFísica Avalia</h1><p>Você está sem conexão com a internet.</p><p>Conecte-se e abra o aplicativo novamente.</p></div></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            )
          )
        );
      }
    });
  `;

  return new Response(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/'
    }
  });
}

async function loginPost(request, env) {
  const f = await request.formData();
  if (String(f.get('password') || '') !== env.TEACHER_PASSWORD) {
    return page('Login', loginForm('Senha incorreta.'), 401);
  }
  const token = await makeSession(env.AUTH_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `teacher=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`
    }
  });
}

function loginForm(error = '') {
  return `
    <main class="future-login-shell">
      <div class="future-login-glow glow-a"></div>
      <div class="future-login-glow glow-b"></div>

      <section class="future-login-card">
        <div class="future-login-brand">
          <span class="future-login-logo">EF</span>
          <div>
            <small>EDUCAFÍSICA</small>
            <b>Avalia</b>
          </div>
        </div>

        <div class="future-login-copy">
          <span class="future-kicker"><i></i> AMBIENTE DO PROFESSOR</span>
          <h1>Avaliação inteligente.<br><em>Decisão mais simples.</em></h1>
          <p>
            Provas, turmas, desempenho, tempo e resultados em um painel pensado
            para funcionar bem também no celular.
          </p>
        </div>

        ${error ? `<div class="future-login-error">⚠ ${esc(error)}</div>` : ''}

        <form method="post" class="future-login-form">
          <label>
            <span>Senha de acesso</span>
            <div class="future-password-field">
              <i>⌁</i>
              <input type="password" name="password" required
                     placeholder="Digite sua senha"
                     autocomplete="current-password">
            </div>
          </label>

          <button type="submit" class="future-login-button">
            Entrar no painel <span>→</span>
          </button>
        </form>

        <div class="future-login-foot">
          <span><i class="future-online-dot"></i> Sistema online</span>
          <span>Educação Física • Avaliação • Dados</span>
        </div>
      </section>
    </main>`;
}

function logout() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login',
      'Set-Cookie': 'teacher=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    }
  });
}

async function makeSession(secret) {
  const ts = Math.floor(Date.now() / 1000).toString();
  return `${ts}.${await hmac(secret, ts)}`;
}

async function isTeacher(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const part = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('teacher='));
  if (!part) return false;
  const token = part.slice(8);
  const [ts, sig] = token.split('.');
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.floor(Date.now() / 1000) - Number(ts) > 43200) return false;
  return sig === await hmac(env.AUTH_SECRET, ts);
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function dashboard(env, message = '') {
  const exams = await env.DB.prepare(`
    SELECT
      e.*,
      COUNT(su.id) AS submissions,
      ROUND(AVG(su.percent),1) AS avg_score,
      ROUND(AVG(su.duration_seconds),0) AS avg_duration,
      sc.id AS school_id,
      sc.name AS school_name,
      cl.shift AS shift,
      COALESCE(cl.class_name,e.class_name) AS linked_class_name,
      COALESCE(cl.grade,e.grade) AS linked_grade,
      COALESCE(ec.trimester,0) AS trimester
    FROM exams e
    LEFT JOIN submissions su ON su.exam_id=e.id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    GROUP BY e.id
    ORDER BY sc.name, cl.shift, linked_class_name, ec.trimester, e.id DESC
  `).all();

  const q = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM questions WHERE active=1'
  ).first();

  const s = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM submissions'
  ).first();

  const openExams = exams.results.filter(e => Number(e.active) === 1).length;

  const classStats = await env.DB.prepare(`
    SELECT
      COALESCE(sc.name,'Sem escola definida') AS school_name,
      COALESCE(cl.shift,'Sem turno') AS shift,
      COALESCE(cl.class_name,e.class_name,'Sem turma') AS class_name,
      COUNT(su.id) AS submissions,
      COUNT(DISTINCT e.id) AS exams,
      ROUND(AVG(su.percent),1) AS avg_percent,
      ROUND(AVG(su.duration_seconds),0) AS avg_duration
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    GROUP BY
      COALESCE(sc.name,'Sem escola definida'),
      COALESCE(cl.shift,'Sem turno'),
      COALESCE(cl.class_name,e.class_name,'Sem turma')
    ORDER BY school_name, shift, class_name
  `).all();

  const studentStats = await env.DB.prepare(`
    SELECT
      su.id,
      su.student_name,
      su.percent,
      su.duration_seconds,
      COALESCE(ea.suspicious_events,0) AS suspicious_events,
      e.id AS exam_id,
      e.title AS exam_title,
      COALESCE(ec.trimester,0) AS trimester,
      COALESCE(sc.name,'Sem escola definida') AS school_name,
      COALESCE(cl.shift,'Sem turno') AS shift,
      COALESCE(cl.class_name,e.class_name,su.student_class,'Sem turma') AS class_name
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_attempts ea ON ea.submission_id=su.id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    ORDER BY
      school_name,
      shift,
      class_name,
      e.id,
      su.student_name COLLATE NOCASE
  `).all();

  const topicStats = await env.DB.prepare(`
    SELECT
      e.id AS exam_id,
      COALESCE(q.topic,'Sem tema') AS topic,
      COUNT(a.question_id) AS answers_count,
      ROUND(AVG(a.is_correct) * 100,1) AS avg_percent
    FROM answers a
    JOIN submissions su ON su.id=a.submission_id
    JOIN exams e ON e.id=su.exam_id
    JOIN questions q ON q.id=a.question_id
    GROUP BY e.id, COALESCE(q.topic,'Sem tema')
    ORDER BY e.id, avg_percent DESC, topic
  `).all();

  const formatMean = value => {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(1).replace('.0','').replace('.', ',');
  };

  const formatAvgTime = seconds => {
    const total = Math.max(0, Math.round(Number(seconds || 0)));
    if (!total) return '—';
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return sec ? `${min}min ${String(sec).padStart(2,'0')}s` : `${min}min`;
  };

  const studentByExam = new Map();

  for (const row of studentStats.results) {
    const id = Number(row.exam_id);
    if (!studentByExam.has(id)) studentByExam.set(id, []);
    studentByExam.get(id).push(row);
  }

  const topicByExam = new Map();

  for (const row of topicStats.results) {
    const id = Number(row.exam_id);
    if (!topicByExam.has(id)) topicByExam.set(id, []);
    topicByExam.get(id).push(row);
  }

  // Organização das provas: Escola → Turno → Turma → somente trimestres existentes.
  const groups = new Map();

  for (const e of exams.results) {
    const school = e.school_name || 'Sem escola definida';
    const shift = e.shift || 'Sem turno';
    const className = e.linked_class_name || e.class_name || 'Sem turma';
    const tri = Number(e.trimester || 0);

    if (!groups.has(school)) {
      groups.set(school, { exams: 0, submissions: 0, open: 0, shifts: new Map() });
    }

    const schoolGroup = groups.get(school);
    schoolGroup.exams += 1;
    schoolGroup.submissions += Number(e.submissions || 0);
    schoolGroup.open += Number(e.active) === 1 ? 1 : 0;

    if (!schoolGroup.shifts.has(shift)) schoolGroup.shifts.set(shift, new Map());
    const shiftGroup = schoolGroup.shifts.get(shift);

    if (!shiftGroup.has(className)) {
      shiftGroup.set(className, { exams: [], trimesters: new Map() });
    }

    const classGroup = shiftGroup.get(className);
    classGroup.exams.push(e);

    if (!classGroup.trimesters.has(tri)) classGroup.trimesters.set(tri, []);
    classGroup.trimesters.get(tri).push(e);
  }

  const trimesterTitle = tri =>
    tri === 1 ? '1º trimestre' :
    tri === 2 ? '2º trimestre' :
    tri === 3 ? '3º trimestre' :
    'Avaliação';

  const trimesterIcon = tri =>
    tri === 1 ? '①' :
    tri === 2 ? '②' :
    tri === 3 ? '③' : '•';

  const examCard = e => {
    const mean = formatMean(e.avg_score);

    return `
      <article class="dash-exam-card"
        data-exam-search="${attr((
          (e.title || '') + ' ' +
          (e.linked_grade || e.grade || '') + ' ' +
          (e.linked_class_name || e.class_name || '') + ' ' +
          (e.school_name || '') + ' ' +
          (e.shift || '')
        ).toLowerCase())}">
        <div class="dash-exam-top">
          <div>
            <span class="status-dot ${Number(e.active) === 1 ? 'is-open' : 'is-closed'}"></span>
            <small>${Number(e.active) === 1 ? 'ABERTA' : 'ENCERRADA'}</small>
          </div>
          <span class="dash-exam-id">#${e.id}</span>
        </div>

        <h4>${esc(e.title)}</h4>
        <p>${esc(e.linked_grade || e.grade || '')}</p>

        <div class="dash-exam-numbers v21-exam-numbers">
          <span><b>${Number(e.submissions || 0)}</b><small>alunos</small></span>
          <span class="${Number(e.avg_score || 0) >= 60 ? 'metric-good' : 'metric-low'}">
            <b>${mean}</b><small>média /100</small>
          </span>
        </div>

        <div class="dash-exam-actions">
          <a class="dash-action primary" href="/provas/${e.id}">Abrir</a>
          <a class="dash-action" href="/provas/${e.id}/resultados">Notas</a>
          <button type="button" class="dash-action link-action"
            onclick="copyExamLink('/e/${attr(e.token)}', this)">🔗</button>
          <form method="post" action="/provas/${e.id}/excluir"
            onsubmit="return confirm('Excluir esta prova e todos os resultados dela? Esta ação não pode ser desfeita.');">
            <button type="submit" class="dash-action delete-action" title="Excluir prova">🗑</button>
          </form>
        </div>
      </article>`;
  };

  const schoolBlocks = [...groups.entries()].map(([schoolName, school], schoolIndex) => {
    const shiftBlocks = [...school.shifts.entries()].map(([shiftName, classes]) => {
      const classBlocks = [...classes.entries()].map(([className, classData]) => {
        const triColumns = [...classData.trimesters.entries()]
          .sort((a,b) => Number(a[0]) - Number(b[0]))
          .map(([tri, list]) => `
            <section class="dash-trimester tri-${tri || 0}">
              <div class="dash-trimester-head">
                <span>${trimesterIcon(Number(tri))}</span>
                <div>
                  <b>${trimesterTitle(Number(tri))}</b>
                  <small>${list.length} prova(s)</small>
                </div>
              </div>
              <div class="dash-trimester-body">
                ${list.map(examCard).join('')}
              </div>
            </section>`
          ).join('');

        return `
          <details class="dash-class-card v21-class-card" open
            data-school-search="${attr((schoolName+' '+shiftName+' '+className+' '+classData.exams.map(x=>x.title).join(' ')).toLowerCase())}">
            <summary>
              <div class="dash-class-summary">
                <span class="dash-class-avatar">${esc(className).slice(0,4)}</span>
                <div>
                  <span class="eyebrow">TURMA</span>
                  <h3>${esc(className)}</h3>
                  <p>${classData.exams.length} prova(s) · ${classData.exams.reduce((n,x)=>n+Number(x.submissions||0),0)} resposta(s)</p>
                </div>
              </div>
              <span class="summary-chevron">›</span>
            </summary>
            <div class="dash-trimester-grid v21-trimester-grid">${triColumns}</div>
          </details>`;
      }).join('');

      return `
        <section class="dash-shift">
          <div class="dash-shift-title">
            <span class="shift-icon">${
              shiftName === 'Noturno' ? '🌙' :
              shiftName === 'Tarde' ? '☀️' :
              shiftName === 'Integral' ? '🕘' : '🌤️'
            }</span>
            <div><span class="eyebrow">TURNO</span><h3>${esc(shiftName)}</h3></div>
          </div>
          ${classBlocks}
        </section>`;
    }).join('');

    const theme = (schoolIndex % 5) + 1;

    return `
      <details class="dash-school school-color-${theme}" open
        data-school-search="${attr(schoolName.toLowerCase())}">
        <summary>
          <div class="dash-school-main">
            <span class="dash-school-icon">🏫</span>
            <div>
              <span class="eyebrow">ESCOLA</span>
              <h2>${esc(schoolName)}</h2>
              <p>${school.exams} prova(s) · ${school.submissions} resposta(s)</p>
            </div>
          </div>
          <span class="summary-chevron">›</span>
        </summary>
        <div class="dash-school-content">${shiftBlocks}</div>
      </details>`;
  }).join('');

  const classStatKey = (school, shift, cls) =>
    `${school}|||${shift}|||${cls}`;

  const examMap = new Map();

  for (const e of exams.results) {
    const key = classStatKey(
      e.school_name || 'Sem escola definida',
      e.shift || 'Sem turno',
      e.linked_class_name || e.class_name || 'Sem turma'
    );

    if (!examMap.has(key)) examMap.set(key, []);
    examMap.get(key).push(e);
  }

  const noteClassCards = classStats.results.map((r, classIndex) => {
    const key = classStatKey(r.school_name, r.shift, r.class_name);
    const classExams = (examMap.get(key) || [])
      .filter(e => Number(e.submissions || 0) > 0)
      .sort((a,b) =>
        Number(a.trimester || 0) - Number(b.trimester || 0) ||
        Number(b.id) - Number(a.id)
      );

    const classMean = formatMean(r.avg_percent);
    const classMeanClass = Number(r.avg_percent || 0) >= 60
      ? 'class-score-good'
      : 'class-score-low';

    const examPerformance = classExams.map((e, examIndex) => {
      const topics = topicByExam.get(Number(e.id)) || [];
      const examMean = formatMean(e.avg_score);
      const examTime = formatAvgTime(e.avg_duration);

      const topicCards = topics.map((t, topicIndex) => {
        const n = Number(t.avg_percent || 0);
        const scoreClass = n >= 60 ? 'topic-score-good' : 'topic-score-low';
        const palette = `topic-palette-${(topicIndex % 6) + 1}`;

        return `
          <div class="topic-performance ${palette}">
            <div class="topic-performance-head">
              <span class="topic-dot"></span>
              <b>${esc(t.topic)}</b>
              <strong class="${scoreClass}">${formatMean(n)}%</strong>
            </div>
            <div class="topic-progress">
              <span style="width:${Math.max(0, Math.min(100, n))}%"></span>
            </div>
            <small>${Number(t.answers_count || 0)} resposta(s) analisada(s)</small>
          </div>`;
      }).join('');

      const examStudents = (studentByExam.get(Number(e.id)) || [])
        .slice()
        .sort((a,b) =>
          String(a.student_name || '').localeCompare(
            String(b.student_name || ''),
            'pt-BR'
          )
        );

      const studentCards = examStudents.map((student, studentIndex) => {
        const note = Number(student.percent || 0);
        const noteText = formatMean(note);
        const noteClass = note >= 60 ? 'v22-student-blue' : 'v22-student-red';

        const initials = String(student.student_name || '?')
          .trim()
          .split(/\s+/)
          .slice(0,2)
          .map(x => x.charAt(0).toUpperCase())
          .join('');

        return `
          <div class="v22-student-card ${noteClass}">
            <span class="v22-student-avatar">${esc(initials || '?')}</span>
            <span class="v22-student-name">
              <b>${esc(student.student_name)}</b>
              <small>Turma ${esc(student.class_name || '')}</small>
              ${Number(student.suspicious_events || 0) > 0
                ? `<em class="v23-exit-mini">↗ ${Number(student.suspicious_events || 0)} saída(s)</em>`
                : ''}
            </span>
            <span class="v22-student-grade">
              <small>NOTA</small>
              <b>${noteText}</b>
              <i>/100</i>
            </span>
          </div>`;
      }).join('');

      return `
        <section class="class-exam-performance">
          <div class="class-exam-head">
            <div>
              <span class="trimester-soft-badge tri-soft-${Number(e.trimester || 0)}">
                ${trimesterIcon(Number(e.trimester || 0))} ${trimesterTitle(Number(e.trimester || 0))}
              </span>
              <h4>${esc(e.title)}</h4>
            </div>

            <a href="/provas/${e.id}/resultados" class="btn small secondary">
              Ver alunos
            </a>
          </div>

          <div class="class-exam-metrics">
            <div>
              <span class="metric-icon metric-blue">★</span>
              <span><small>MÉDIA DA TURMA</small><b class="${Number(e.avg_score || 0) >= 60 ? 'metric-good' : 'metric-low'}">${examMean}</b></span>
            </div>
            <div>
              <span class="metric-icon metric-mint">⏱</span>
              <span><small>TEMPO MÉDIO</small><b>${examTime}</b></span>
            </div>
            <div>
              <span class="metric-icon metric-lilac">👥</span>
              <span><small>ALUNOS</small><b>${Number(e.submissions || 0)}</b></span>
            </div>
          </div>

          <div class="topic-performance-section">
            <div class="topic-performance-title">
              <span>◫</span>
              <div>
                <b>Desempenho por tema</b>
                <small>Percentual médio de acertos da turma em cada assunto.</small>
              </div>
            </div>

            <div class="topic-performance-grid">
              ${topicCards || '<p class="muted">Ainda não há dados por tema.</p>'}
            </div>
          </div>

          <div class="v22-students-section">
            <div class="v22-students-title">
              <div>
                <span class="v22-students-icon">👥</span>
                <span>
                  <b>Alunos desta turma</b>
                  <small>${examStudents.length} aluno(s) · em ordem alfabética</small>
                </span>
              </div>
              <a href="/provas/${e.id}/resultados">Ver detalhes →</a>
            </div>

            <div class="v22-student-grid">
              ${studentCards || '<p class="muted">Ainda não há alunos com nota nesta prova.</p>'}
            </div>
          </div>
        </section>`;
    }).join('');

    return `
      <details class="class-performance-card class-accent-${(classIndex % 5) + 1}" open>
        <summary>
          <div class="class-performance-main">
            <span class="class-performance-avatar">${esc(r.class_name).slice(0,4)}</span>
            <div>
              <span class="eyebrow">TURMA</span>
              <h3>${esc(r.class_name)}</h3>
              <p>${esc(r.school_name)} · ${esc(r.shift)}</p>
            </div>
          </div>

          <div class="class-performance-summary">
            <span>
              <small>MÉDIA DA TURMA</small>
              <b class="${classMeanClass}">${classMean}</b>
            </span>
            <span>
              <small>TEMPO MÉDIO</small>
              <b>${formatAvgTime(r.avg_duration)}</b>
            </span>
            <i class="summary-chevron">›</i>
          </div>
        </summary>

        <div class="class-performance-body">
          ${examPerformance || '<p class="muted">Ainda não há avaliações respondidas nesta turma.</p>'}
        </div>
      </details>`;
  }).join('');

  const evaluatedClasses = classStats.results.length;

  const messageBox = message === 'deleted'
    ? `<div class="dashboard-toast-success">✓ Prova excluída com sucesso.</div>`
    : '';

  return page(
    'Painel',
    nav() + `
      <main class="dashboard-v16 dashboard-v21">
        ${messageBox}

        <section class="future-home-hero home-theme-aurora" id="futureHomeHero">
          <div class="future-hero-grid"></div>
          <div class="future-orb orb-one"></div>
          <div class="future-orb orb-two"></div>

          <div class="future-theme-switcher" aria-label="Escolher tema visual">
            <button type="button" class="theme-dot active" data-home-theme="aurora" title="Aurora"></button>
            <button type="button" class="theme-dot" data-home-theme="ocean" title="Horizonte"></button>
            <button type="button" class="theme-dot" data-home-theme="light" title="Luz"></button>
          </div>

          <div class="future-hero-copy">
            <div class="future-hero-status">
              <span class="future-live-dot"></span>
              AVALIAÇÃO INTELIGENTE
            </div>

            <span class="eyebrow future-eyebrow">EDUCAFÍSICA AVALIA</span>
            <h1>Avaliar. Compreender.<br><em>Evoluir.</em></h1>
            <p>
              Provas inteligentes, turmas organizadas e resultados que mostram
              mais do que uma nota.
            </p>

            <div class="future-value-pills">
              <span>📝 Provas inteligentes</span>
              <span>👥 Turmas organizadas</span>
              <span>📊 Dados claros</span>
              <span>⚖ Avaliação justa</span>
            </div>

            <div class="future-hero-buttons">
              <a class="future-main-button" href="/provas/nova">
                <span>＋</span>
                <div><b>Criar nova prova</b><small>Individual ou várias turmas</small></div>
                <i>→</i>
              </a>

              <a class="future-ghost-button" href="/alunos">
                <span>◎</span>
                <div><b>Alunos e resultados</b><small>Notas, tempo e saídas</small></div>
              </a>
            </div>
          </div>

          <div class="future-command-card">
            <div class="future-command-head">
              <span>VISÃO GERAL</span>
              <i></i>
            </div>

            <div class="future-command-number">
              <small>RESPOSTAS RECEBIDAS</small>
              <b>${s.c || 0}</b>
            </div>

            <div class="future-command-mini">
              <div><span>Turmas</span><b>${evaluatedClasses}</b></div>
              <div><span>Provas abertas</span><b>${openExams}</b></div>
              <div><span>Questões</span><b>${q.c || 0}</b></div>
            </div>

            <div class="future-signal">
              <span><i></i></span>
              <div><b>Tudo conectado</b><small>Provas, alunos, banco, resultados e RCO</small></div>
            </div>
          </div>
        </section>

        <section class="dash-primary-actions v21-primary-actions v26-primary-actions v32-primary-actions">
          <a href="/provas/nova" class="v32-action-card blue">
            <span class="v32-action-art">📝</span>
            <div>
              <b>Criar prova</b>
              <small>Nova avaliação</small>
            </div>
          </a>

          <a href="/alunos" class="v32-action-card green">
            <span class="v32-action-art">👨‍🎓</span>
            <div>
              <b>Alunos</b>
              <small>Notas e dados</small>
            </div>
          </a>

          <a href="/medias-finais" class="v32-action-card purple">
            <span class="v32-action-art">📈</span>
            <div>
              <b>Médias finais</b>
              <small>Prova + recuperação</small>
            </div>
          </a>

          <a href="/caderno" class="v32-action-card orange">
            <span class="v32-action-art">📒</span>
            <div>
              <b>Caderno RCO</b>
              <small>Copiar e baixar</small>
            </div>
          </a>

          <a href="/banco" class="v32-action-card cyan">
            <span class="v32-action-art">🧠</span>
            <div>
              <b>Banco de questões</b>
              <small>Questões e imagens</small>
            </div>
          </a>

          <a href="/resultados" class="v32-action-card gold">
            <span class="v32-action-art">📊</span>
            <div>
              <b>Resultados</b>
              <small>Gráficos e provas</small>
            </div>
          </a>
        </section>

        <section class="v30-app-strip">
          <div class="v30-app-icon">EF</div>
          <div>
            <span class="eyebrow blue">APLICATIVO</span>
            <b>EducaFísica Avalia também pode ficar instalado no celular</b>
            <small>Use o ícone ⇩ no topo. Depois ele abre como aplicativo, sem precisar procurar o endereço no navegador.</small>
          </div>
          <button type="button" class="btn small secondary" onclick="document.getElementById('installAppBtn')?.click()">
            ⇩ Instalar app
          </button>
        </section>

        <section class="dash-summary-strip v21-summary-strip">
          <div class="dash-summary-card blue">
            <span>👥</span><b>${evaluatedClasses}</b><small>Turmas avaliadas</small>
          </div>
          <div class="dash-summary-card green">
            <span>✓</span><b>${s.c || 0}</b><small>Respostas recebidas</small>
          </div>
          <div class="dash-summary-card purple">
            <span>📝</span><b>${openExams}</b><small>Provas abertas</small>
          </div>
          <div class="dash-summary-card orange">
            <span>❓</span><b>${q.c || 0}</b><small>Questões ativas</small>
          </div>
        </section>

        <div class="dash-tabs v21-tabs" role="tablist">
          <button type="button" class="dash-tab active" data-tab="provas">📝 Provas e turmas</button>
          <button type="button" class="dash-tab" data-tab="notas">📊 Desempenho das turmas</button>
        </div>

        <section id="dashTabProvas" class="dash-tab-panel active">
          <div class="dash-section-head">
            <div>
              <span class="eyebrow blue">MINHAS PROVAS</span>
              <h2>Somente avaliações existentes</h2>
              <p>Não aparecem mais trimestres vazios. Cada turma mostra apenas o trimestre em que existe prova.</p>
            </div>

            <div class="search-box dash-search">
              <span>⌕</span>
              <input id="schoolSearch" placeholder="Buscar escola, turma ou prova">
            </div>
          </div>

          <div id="schoolList">
            ${schoolBlocks || `
              <div class="card empty-state">
                <div class="empty-icon">📝</div>
                <h2>Nenhuma prova criada</h2>
                <p>Crie uma prova e ela aparecerá aqui na turma correta.</p>
                <a class="btn" href="/provas/nova">Criar primeira prova</a>
              </div>`}
          </div>

          <div class="dash-tools card">
            <div>
              <span class="eyebrow">FERRAMENTAS</span>
              <b>Testes e manutenção</b>
              <small>Recursos menos usados ficam separados para manter o painel limpo.</small>
            </div>
            <div>
              <a class="btn small secondary" href="/banco#importar">Importar questões</a>
              <a class="btn small recalc-soft" href="/notas/recalcular-antigas">⚖ Recalcular notas antigas</a>
              <a class="btn small danger-soft" href="/provas/zerar">Zerar provas de teste</a>
            </div>
          </div>
        </section>

        <section id="dashTabNotas" class="dash-tab-panel">
          <div class="v21-notes-head">
            <div>
              <span class="eyebrow blue">DESEMPENHO</span>
              <h2>Médias, tempo e temas por turma</h2>
              <p>Sem média geral: cada turma é analisada separadamente.</p>
            </div>

            <div class="v21-rco-button">
              <a class="btn" href="/caderno">▦ Abrir Caderno RCO</a>
              <small>Para copiar as notas dos alunos.</small>
            </div>
          </div>

          <div class="class-performance-list">
            ${noteClassCards || `
              <div class="card empty-state">
                <div class="empty-icon">📊</div>
                <h2>Ainda não há desempenho para mostrar</h2>
                <p>As médias e tempos aparecerão quando os alunos concluírem as provas.</p>
              </div>`}
          </div>
        </section>
      </main>

      <div id="copyToast" class="copy-toast">✓ Link da prova copiado</div>

      <script>
        const tabs = document.querySelectorAll('.dash-tab');
        const panelProvas = document.getElementById('dashTabProvas');
        const panelNotas = document.getElementById('dashTabNotas');

        tabs.forEach(tab => {
          tab.addEventListener('click', () => {
            tabs.forEach(x => x.classList.remove('active'));
            tab.classList.add('active');

            const isProvas = tab.dataset.tab === 'provas';
            panelProvas.classList.toggle('active', isProvas);
            panelNotas.classList.toggle('active', !isProvas);
          });
        });

        const search = document.getElementById('schoolSearch');

        if (search) {
          search.addEventListener('input', () => {
            const term = search.value.trim().toLowerCase();

            document.querySelectorAll('.dash-school').forEach(school => {
              const schoolText = school.textContent.toLowerCase();
              const match = !term || schoolText.includes(term);

              school.style.display = match ? '' : 'none';

              if (term && match) {
                school.open = true;
                school.querySelectorAll('.dash-class-card').forEach(c => c.open = true);
              }
            });
          });
        }

        async function copyExamLink(path, button) {
          const link = location.origin + path;

          try {
            await navigator.clipboard.writeText(link);
            const old = button.innerHTML;
            button.innerHTML = '✓';
            button.classList.add('copied');
            showCopyToast();

            setTimeout(() => {
              button.innerHTML = old;
              button.classList.remove('copied');
            }, 1500);
          } catch (e) {
            prompt('Copie o link da prova:', link);
          }
        }

        function showCopyToast() {
          const toast = document.getElementById('copyToast');
          if (!toast) return;

          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 1500);
        }

        // Tema visual da tela inicial
        const homeHero = document.getElementById('futureHomeHero');
        const themeDots = [...document.querySelectorAll('[data-home-theme]')];

        function applyHomeTheme(theme) {
          if (!homeHero) return;

          homeHero.classList.remove(
            'home-theme-aurora',
            'home-theme-ocean',
            'home-theme-light'
          );

          homeHero.classList.add('home-theme-' + theme);

          themeDots.forEach(btn => {
            btn.classList.toggle(
              'active',
              btn.dataset.homeTheme === theme
            );
          });

          try {
            localStorage.setItem('educafisica-home-theme', theme);
          } catch (_) {}
        }

        let savedHomeTheme = 'aurora';

        try {
          savedHomeTheme =
            localStorage.getItem('educafisica-home-theme') || 'aurora';
        } catch (_) {}

        if (!['aurora','ocean','light'].includes(savedHomeTheme)) {
          savedHomeTheme = 'aurora';
        }

        applyHomeTheme(savedHomeTheme);

        themeDots.forEach(btn => {
          btn.addEventListener('click', () => {
            applyHomeTheme(btn.dataset.homeTheme);
          });
        });
      </script>
    `
  );
}


async function recalculateLegacyGradesPage(env, message = '', result = null) {
  await ensureExamAttemptTables(env);

  const totals = await env.DB.prepare(`
    SELECT
      COUNT(su.id) AS total_submissions,
      SUM(CASE WHEN ea.id IS NOT NULL THEN 1 ELSE 0 END) AS linked_attempts,
      SUM(CASE WHEN COALESCE(ea.suspicious_events,0) > 0 THEN 1 ELSE 0 END) AS with_exits,
      SUM(CASE WHEN ea.id IS NULL THEN 1 ELSE 0 END) AS without_attempt
    FROM submissions su
    LEFT JOIN exam_attempts ea ON ea.submission_id=su.id
  `).first();

  const preview = await env.DB.prepare(`
    SELECT
      su.id,
      su.student_name,
      su.percent AS current_percent,
      e.title AS exam_title,
      COALESCE(sc.name,'Sem escola') AS school_name,
      COALESCE(cl.class_name,e.class_name,su.student_class,'Sem turma') AS class_name,
      COALESCE(ea.suspicious_events,0) AS exits,
      COALESCE(SUM(a.is_correct),0) AS correct_answers,
      COUNT(a.question_id) AS total_answers,
      e.total_points
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_attempts ea ON ea.submission_id=su.id
    LEFT JOIN answers a ON a.submission_id=su.id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    WHERE COALESCE(ea.suspicious_events,0) > 0
    GROUP BY su.id
    ORDER BY exits DESC, su.student_name COLLATE NOCASE
    LIMIT 12
  `).all();

  const previewRows = preview.results.map(row => {
    const totalAnswers = Number(row.total_answers || 0);
    const correct = Number(row.correct_answers || 0);
    const totalPoints = Math.max(0, Number(row.total_points || 100));
    const rawPercent = totalAnswers
      ? Math.round((correct / totalAnswers) * 1000) / 10
      : Number(row.current_percent || 0);
    const rawScore = Math.round((rawPercent / 100) * totalPoints * 100) / 100;
    const penalty = examExitPenalty({ total_points: totalPoints }, Number(row.exits || 0));
    const finalScore = Math.max(
      0,
      Math.round((rawScore - Math.min(rawScore, penalty.penalty_points)) * 100) / 100
    );
    const finalPercent = totalPoints > 0
      ? Math.round((finalScore / totalPoints) * 1000) / 10
      : 0;

    return `
      <tr>
        <td>${esc(row.student_name)}</td>
        <td>${esc(row.class_name)}</td>
        <td>${Number(row.exits || 0)}</td>
        <td>${formatPenaltyValue(rawPercent)}</td>
        <td>−${formatPenaltyValue(Math.max(0, rawPercent - finalPercent))}</td>
        <td><b>${formatPenaltyValue(finalPercent)}</b></td>
      </tr>`;
  }).join('');

  return page(
    'Recalcular notas antigas',
    nav() + `
      <main class="legacy-recalc-page">
        <section class="legacy-recalc-card">
          <div class="legacy-recalc-icon">⚖</div>
          <span class="eyebrow blue">JUSTIÇA ENTRE AS TURMAS</span>
          <h1>Recalcular notas anteriores</h1>
          <p class="legacy-recalc-lead">
            Esta ferramenta aplica a mesma fórmula atual às provas já realizadas:
            <b>desconto por saída = valor da prova ÷ 50 minutos</b>.
          </p>

          ${message ? `
            <div class="${result ? 'legacy-recalc-success' : 'legacy-recalc-warning'}">
              ${esc(message)}
            </div>` : ''}

          ${result ? `
            <div class="legacy-recalc-result">
              <div><small>Notas verificadas</small><b>${Number(result.checked || 0)}</b></div>
              <div><small>Com saídas registradas</small><b>${Number(result.withExits || 0)}</b></div>
              <div><small>Notas alteradas</small><b>${Number(result.changed || 0)}</b></div>
              <div><small>Sem tentativa registrada</small><b>${Number(result.withoutAttempt || 0)}</b></div>
            </div>
          ` : ''}

          <div class="legacy-recalc-summary">
            <div>
              <span>📄</span>
              <small>Resultados existentes</small>
              <b>${Number(totals?.total_submissions || 0)}</b>
            </div>
            <div>
              <span>🔗</span>
              <small>Com tentativa vinculada</small>
              <b>${Number(totals?.linked_attempts || 0)}</b>
            </div>
            <div>
              <span>↗</span>
              <small>Com saídas registradas</small>
              <b>${Number(totals?.with_exits || 0)}</b>
            </div>
          </div>

          <div class="legacy-recalc-info">
            <b>Importante</b>
            <p>
              O sistema recalcula a partir dos <b>acertos originais</b> e do número de
              <b>saídas já gravadas</b>. Portanto, executar novamente não desconta duas vezes.
              A nota é sempre refeita do zero com a fórmula atual.
            </p>
          </div>

          <div class="legacy-recalc-info soft">
            <b>Resultados muito antigos</b>
            <p>
              Se uma prova foi realizada antes de o sistema registrar tentativas/saídas,
              não existe dado técnico para inventar uma penalidade. Esses resultados serão mantidos.
            </p>
          </div>

          ${previewRows ? `
            <div class="legacy-preview">
              <div>
                <span class="eyebrow blue">PRÉVIA</span>
                <h2>Exemplos de notas que serão recalculadas</h2>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Aluno</th>
                      <th>Turma</th>
                      <th>Saídas</th>
                      <th>Nota respostas</th>
                      <th>Desconto</th>
                      <th>Nova nota</th>
                    </tr>
                  </thead>
                  <tbody>${previewRows}</tbody>
                </table>
              </div>
            </div>
          ` : `
            <div class="legacy-recalc-info soft">
              <b>Nenhuma penalidade pendente</b>
              <p>Não encontrei resultados antigos com saídas registradas.</p>
            </div>
          `}

          <form method="post" action="/notas/recalcular-antigas"
                class="legacy-recalc-form"
                onsubmit="return confirm('Confirmar o recálculo das notas já realizadas usando a regra atual de desconto por saída?');">
            <label>
              Para confirmar, digite <b>RECALCULAR</b>
              <input name="confirm_text"
                     autocomplete="off"
                     placeholder="Digite RECALCULAR"
                     required>
            </label>

            <button type="submit" class="recalc-button">
              ⚖ Aplicar a mesma regra às notas anteriores
            </button>

            <a class="btn secondary" href="/">Cancelar e voltar</a>
          </form>
        </section>
      </main>
    `
  );
}

async function recalculateLegacyGrades(request, env) {
  const f = await request.formData();
  const confirmText = String(f.get('confirm_text') || '').trim().toUpperCase();

  if (confirmText !== 'RECALCULAR') {
    return recalculateLegacyGradesPage(
      env,
      'Nada foi alterado. Digite exatamente RECALCULAR para confirmar.'
    );
  }

  await ensureExamAttemptTables(env);

  const rows = await env.DB.prepare(`
    SELECT
      su.id AS submission_id,
      su.score AS old_score,
      su.percent AS old_percent,
      e.id AS exam_id,
      e.total_points,
      ea.id AS attempt_id,
      COALESCE(ea.suspicious_events,0) AS exits,
      COALESCE(SUM(a.is_correct),0) AS correct_answers,
      COUNT(a.question_id) AS total_answers
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_attempts ea ON ea.submission_id=su.id
    LEFT JOIN answers a ON a.submission_id=su.id
    GROUP BY su.id
    ORDER BY su.id
  `).all();

  let checked = 0;
  let withExits = 0;
  let changed = 0;
  let withoutAttempt = 0;

  const updates = [];

  for (const row of rows.results) {
    checked += 1;

    if (!row.attempt_id) {
      withoutAttempt += 1;
      continue;
    }

    const exits = Math.max(0, Number(row.exits || 0));
    if (exits > 0) withExits += 1;

    const totalAnswers = Number(row.total_answers || 0);

    // Sem respostas detalhadas, não é possível reconstruir com segurança a nota bruta.
    if (!totalAnswers) continue;

    const correct = Number(row.correct_answers || 0);
    const totalPoints = Math.max(0, Number(row.total_points || 100));

    const rawPercent = Math.round(
      (correct / totalAnswers) * 1000
    ) / 10;

    const rawScore = Math.round(
      (rawPercent / 100) * totalPoints * 100
    ) / 100;

    const penalty = examExitPenalty(
      { total_points: totalPoints },
      exits
    );

    const appliedPenalty = Math.min(
      rawScore,
      penalty.penalty_points
    );

    const newScore = Math.max(
      0,
      Math.round((rawScore - appliedPenalty) * 100) / 100
    );

    const newPercent = totalPoints > 0
      ? Math.round((newScore / totalPoints) * 1000) / 10
      : 0;

    const oldScore = Number(row.old_score || 0);
    const oldPercent = Number(row.old_percent || 0);

    if (
      Math.abs(oldScore - newScore) > 0.001 ||
      Math.abs(oldPercent - newPercent) > 0.001
    ) {
      changed += 1;
    }

    updates.push(
      env.DB.prepare(`
        UPDATE submissions
        SET score=?, percent=?
        WHERE id=?
      `).bind(
        newScore,
        newPercent,
        Number(row.submission_id)
      )
    );
  }

  // D1 batch com blocos menores para bancos maiores.
  for (let i = 0; i < updates.length; i += 50) {
    await env.DB.batch(updates.slice(i, i + 50));
  }

  return recalculateLegacyGradesPage(
    env,
    `Recálculo concluído. ${changed} nota(s) foram atualizadas pela regra atual.`,
    {
      checked,
      withExits,
      changed,
      withoutAttempt
    }
  );
}

async function resetCreatedExamsPage(env, message = '') {
  const e = await env.DB.prepare('SELECT COUNT(*) AS c FROM exams').first();
  const s = await env.DB.prepare('SELECT COUNT(*) AS c FROM submissions').first();

  return page(
    'Zerar provas de teste',
    nav() + `
      <main class="student reset-page">
        <section class="reset-card">
          <div class="reset-icon">⌫</div>
          <span class="eyebrow red-text">FERRAMENTA DE TESTE</span>
          <h1>Zerar provas criadas</h1>
          <p class="reset-lead">
            Use esta opção para limpar as avaliações de teste e começar novamente com o painel vazio.
          </p>

          ${message ? `<div class="reset-success">${esc(message)}</div>` : ''}

          <div class="reset-summary">
            <div><small>Provas que serão apagadas</small><b>${Number(e?.c || 0)}</b></div>
            <div><small>Respostas que serão apagadas</small><b>${Number(s?.c || 0)}</b></div>
          </div>

          <div class="reset-warning">
            <b>O que será apagado</b>
            <p>Provas criadas, questões vinculadas às provas, resultados, respostas dos alunos, tentativas e cronômetros dessas provas.</p>
          </div>

          <div class="reset-safe">
            <b>O que será mantido</b>
            <p>Banco de questões, escolas, turnos e turmas. Nada disso será apagado.</p>
          </div>

          <form method="post" action="/provas/zerar" class="reset-form"
                onsubmit="return confirm('Confirma apagar TODAS as provas criadas e seus resultados? O banco de questões e as escolas serão mantidos.');">
            <label>
              Para confirmar, digite <b>ZERAR</b>
              <input name="confirm_text" autocomplete="off" placeholder="Digite ZERAR" required>
            </label>
            <button class="danger-button" type="submit">⌫ Zerar provas criadas</button>
            <a class="btn secondary" href="/">Cancelar e voltar</a>
          </form>
        </section>
      </main>
    `
  );
}

async function resetCreatedExams(request, env) {
  const f = await request.formData();
  const confirmText = String(f.get('confirm_text') || '').trim().toUpperCase();

  if (confirmText !== 'ZERAR') {
    return resetCreatedExamsPage(env, 'Nada foi apagado. Digite exatamente ZERAR para confirmar.');
  }

  await ensureExamAttemptTables(env);

  const beforeExams = await env.DB.prepare('SELECT COUNT(*) AS c FROM exams').first();
  const beforeSubs = await env.DB.prepare('SELECT COUNT(*) AS c FROM submissions').first();

  // A ordem evita registros órfãos e respeita possíveis chaves estrangeiras.
  await ensureExamVariantTables(env);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM attempt_questions`),
    env.DB.prepare(`
      DELETE FROM attempt_answers
      WHERE attempt_id IN (SELECT id FROM exam_attempts)
    `),
    env.DB.prepare(`DELETE FROM exam_attempts`),
    env.DB.prepare(`
      DELETE FROM answers
      WHERE submission_id IN (SELECT id FROM submissions)
    `),
    env.DB.prepare(`DELETE FROM submissions`),
    env.DB.prepare(`DELETE FROM exam_questions`),
    env.DB.prepare(`DELETE FROM exam_context`),
    env.DB.prepare(`DELETE FROM exam_variant_settings`),
    env.DB.prepare(`DELETE FROM exams`)
  ]);

  const deletedExams = Number(beforeExams?.c || 0);
  const deletedSubs = Number(beforeSubs?.c || 0);

  return page(
    'Painel zerado',
    nav() + `
      <main class="student reset-page">
        <section class="reset-card success-reset">
          <div class="success">✓</div>
          <span class="eyebrow blue">LIMPEZA CONCLUÍDA</span>
          <h1>Painel de provas zerado</h1>
          <p>Foram apagadas <b>${deletedExams}</b> prova(s) e <b>${deletedSubs}</b> resposta(s) de teste.</p>
          <div class="reset-safe">
            <b>Seu banco continua intacto</b>
            <p>Questões, escolas, turnos e turmas foram preservados.</p>
          </div>
          <div class="form-actions">
            <a class="btn" href="/">Voltar ao painel</a>
            <a class="btn secondary" href="/provas/nova">Criar nova prova</a>
          </div>
        </section>
      </main>
    `
  );
}


async function studentResultsHub(url, env) {
  await ensureExamAttemptTables(env);

  const selectedSchool = Number(url.searchParams.get('school_id') || 0);
  const selectedClasses = url.searchParams
    .getAll('class_id')
    .map(Number)
    .filter(x => Number.isInteger(x) && x > 0)
    .slice(0, 30);
  const selectedExam = Number(url.searchParams.get('exam_id') || 0);

  const schools = await env.DB.prepare(`
    SELECT DISTINCT
      s.id,
      s.name
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools s ON s.id=ec.school_id
    WHERE s.id IS NOT NULL
    ORDER BY s.name COLLATE NOCASE
  `).all();

  const classes = await env.DB.prepare(`
    SELECT DISTINCT
      c.id,
      c.school_id,
      c.class_name,
      c.grade,
      c.shift
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE c.id IS NOT NULL
    ORDER BY c.school_id, c.shift, c.class_name COLLATE NOCASE
  `).all();

  const exams = await env.DB.prepare(`
    SELECT DISTINCT
      e.id,
      e.title,
      ec.school_id,
      ec.school_class_id,
      COALESCE(ec.trimester,0) AS trimester
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    ORDER BY e.id DESC
  `).all();

  const schoolName = selectedSchool
    ? (schools.results.find(x => Number(x.id) === selectedSchool)?.name || '')
    : '';

  const visibleExamOptions = exams.results.filter(e => {
    if (selectedSchool && Number(e.school_id) !== selectedSchool) return false;
    if (selectedClasses.length && !selectedClasses.includes(Number(e.school_class_id))) return false;
    return true;
  });

  let rows = [];

  if (selectedSchool && selectedClasses.length) {
    const placeholders = selectedClasses.map(() => '?').join(',');
    const params = [selectedSchool, ...selectedClasses];

    let examFilter = '';
    if (selectedExam) {
      examFilter = ' AND e.id=?';
      params.push(selectedExam);
    }

    const result = await env.DB.prepare(`
      SELECT
        su.id AS submission_id,
        su.student_name,
        su.score AS final_score,
        su.percent AS final_percent,
        su.duration_seconds,
        e.id AS exam_id,
        e.title AS exam_title,
        e.total_points,
        COALESCE(ec.trimester,0) AS trimester,
        s.id AS school_id,
        s.name AS school_name,
        c.id AS class_id,
        c.class_name,
        c.grade,
        c.shift,
        COALESCE(ea.suspicious_events,0) AS suspicious_events,
        COALESCE(SUM(a.is_correct),0) AS correct_answers,
        COUNT(a.question_id) AS total_answers
      FROM submissions su
      JOIN exams e ON e.id=su.exam_id
      LEFT JOIN exam_attempts ea ON ea.submission_id=su.id
      LEFT JOIN answers a ON a.submission_id=su.id
      LEFT JOIN exam_context ec ON ec.exam_id=e.id
      LEFT JOIN schools s ON s.id=ec.school_id
      LEFT JOIN school_classes c ON c.id=ec.school_class_id
      WHERE s.id=?
        AND c.id IN (${placeholders})
        ${examFilter}
      GROUP BY su.id
      ORDER BY
        c.shift,
        c.class_name COLLATE NOCASE,
        e.id DESC,
        su.student_name COLLATE NOCASE
    `).bind(...params).all();

    rows = result.results;
  }

  const enriched = rows.map(r => {
    const totalAnswers = Number(r.total_answers || 0);
    const correct = Number(r.correct_answers || 0);
    const totalPoints = Math.max(0, Number(r.total_points || 100));

    const rawPercent = totalAnswers
      ? Math.round((correct / totalAnswers) * 1000) / 10
      : Number(r.final_percent || 0);

    const rawScore = Math.round(
      (rawPercent / 100) * totalPoints * 100
    ) / 100;

    const finalScore = Number(r.final_score || 0);
    const finalPercent = Number(r.final_percent || 0);

    const discountPoints = Math.max(
      0,
      Math.round((rawScore - finalScore) * 100) / 100
    );

    const discountPercent = Math.max(
      0,
      Math.round((rawPercent - finalPercent) * 10) / 10
    );

    return {
      ...r,
      rawPercent,
      rawScore,
      finalScore,
      finalPercent,
      discountPoints,
      discountPercent,
      exits: Number(r.suspicious_events || 0)
    };
  });

  const groups = new Map();

  for (const r of enriched) {
    const key = `${r.class_id}|||${r.exam_id}`;

    if (!groups.has(key)) {
      groups.set(key, {
        class_id: r.class_id,
        class_name: r.class_name || 'Sem turma',
        grade: r.grade || '',
        shift: r.shift || '',
        exam_id: r.exam_id,
        exam_title: r.exam_title || '',
        trimester: Number(r.trimester || 0),
        students: []
      });
    }

    groups.get(key).students.push(r);
  }

  const triText = tri =>
    tri === 1 ? '1º trimestre' :
    tri === 2 ? '2º trimestre' :
    tri === 3 ? '3º trimestre' : 'Avaliação';

  const groupHtml = [...groups.values()].map((g, index) => {
    const avg = g.students.length
      ? g.students.reduce((n,x) => n + Number(x.finalPercent || 0), 0) / g.students.length
      : 0;

    const avgTime = g.students.length
      ? g.students.reduce((n,x) => n + Number(x.duration_seconds || 0), 0) / g.students.length
      : 0;

    const totalExits = g.students.reduce((n,x) => n + Number(x.exits || 0), 0);
    const totalDiscount = g.students.reduce((n,x) => n + Number(x.discountPercent || 0), 0);

    const studentRows = g.students
      .slice()
      .sort((a,b) =>
        String(a.student_name || '').localeCompare(
          String(b.student_name || ''),
          'pt-BR'
        )
      )
      .map(student => {
        const initials = String(student.student_name || '?')
          .trim()
          .split(/\s+/)
          .slice(0,2)
          .map(x => x.charAt(0).toUpperCase())
          .join('');

        const finalClass = student.finalPercent >= 60
          ? 'future-final-good'
          : 'future-final-low';

        const exitClass = student.exits > 0
          ? 'future-exit-alert'
          : 'future-exit-clean';

        return `
          <article class="future-student-result">
            <div class="future-student-id">
              <span class="future-student-avatar">${esc(initials || '?')}</span>
              <div>
                <b>${esc(student.student_name)}</b>
                <small>${esc(g.class_name)} · ${esc(g.shift)}</small>
              </div>
            </div>

            <div class="future-result-data">
              <span>
                <small>NOTA RESPOSTAS</small>
                <b>${formatPenaltyValue(student.rawPercent)}</b>
              </span>

              <span>
                <small>TEMPO</small>
                <b>${formatDuration(student.duration_seconds)}</b>
              </span>

              <span class="${exitClass}">
                <small>SAÍDAS</small>
                <b>${student.exits}</b>
              </span>

              <span class="${student.discountPercent > 0 ? 'future-discount-on' : 'future-discount-off'}">
                <small>DESCONTO</small>
                <b>${student.discountPercent > 0 ? '−' + formatPenaltyValue(student.discountPercent) : '0'}</b>
              </span>

              <span class="future-final-score ${finalClass}">
                <small>NOTA FINAL</small>
                <b>${formatPenaltyValue(student.finalPercent)}</b>
                <i>/100</i>
              </span>
            </div>
          </article>`;
      }).join('');

    return `
      <details class="future-class-result future-class-${(index % 5) + 1}" open>
        <summary>
          <div class="future-class-main">
            <span class="future-class-code">${esc(g.class_name).slice(0,4)}</span>
            <div>
              <span class="future-mini-label">TURMA · ${esc(g.shift)}</span>
              <h2>${esc(g.class_name)}</h2>
              <p>${esc(g.exam_title)} · ${triText(g.trimester)}</p>
            </div>
          </div>

          <div class="future-class-kpis">
            <span><small>ALUNOS</small><b>${g.students.length}</b></span>
            <span><small>MÉDIA</small><b>${formatPenaltyValue(avg)}</b></span>
            <span><small>TEMPO MÉDIO</small><b>${formatDuration(Math.round(avgTime))}</b></span>
            <span><small>SAÍDAS</small><b>${totalExits}</b></span>
            <i class="summary-chevron">›</i>
          </div>
        </summary>

        <div class="future-class-body">
          <div class="future-class-insight">
            <span>◎</span>
            <div>
              <b>Leitura rápida da avaliação</b>
              <small>
                ${totalExits
                  ? `${totalExits} saída(s) registradas nesta turma · ${formatPenaltyValue(totalDiscount)} ponto(s) percentuais descontados no total.`
                  : 'Nenhuma saída registrada nesta avaliação.'}
              </small>
            </div>
            <a href="/provas/${g.exam_id}/resultados">Abrir prova →</a>
          </div>

          <div class="future-student-results-list">
            ${studentRows}
          </div>
        </div>
      </details>`;
  }).join('');

  const classCheckboxes = classes.results.map(c => `
    <label class="future-class-filter"
           data-school-id="${Number(c.school_id || 0)}">
      <input type="checkbox"
             name="class_id"
             value="${Number(c.id)}"
             ${selectedClasses.includes(Number(c.id)) ? 'checked' : ''}>
      <span>
        <b>${esc(c.class_name)}</b>
        <small>${esc(c.shift || '')}${c.grade ? ` · ${esc(c.grade)}` : ''}</small>
      </span>
    </label>
  `).join('');

  const examOptions = visibleExamOptions.map(e => `
    <option value="${Number(e.id)}" ${selectedExam === Number(e.id) ? 'selected' : ''}>
      ${esc(e.title)}${Number(e.trimester || 0) ? ` · ${Number(e.trimester)}º tri.` : ''}
    </option>
  `).join('');

  return page(
    'Alunos e resultados',
    nav() + `
      <main class="future-results-hub">
        <section class="future-results-hero">
          <div class="future-results-orb"></div>
          <div>
            <span class="future-kicker light"><i></i> CENTRAL DE RESULTADOS</span>
            <h1>Alunos e resultados</h1>
            <p>Escolha a escola e as turmas. Depois veja cada aluno sem misturar informações.</p>
          </div>

          <div class="future-results-badge">
            <span>◎</span>
            <div><small>VISÃO</small><b>Professor</b></div>
          </div>
        </section>

        <form method="get" action="/alunos" class="future-filter-panel">
          <div class="future-filter-head">
            <div>
              <span class="eyebrow blue">FILTROS</span>
              <h2>Selecione escola e turmas</h2>
              <p>Você pode marcar uma ou várias turmas da mesma escola.</p>
            </div>

            <button type="button" class="future-clear-filter" id="clearStudentFilters">
              Limpar
            </button>
          </div>

          <div class="future-filter-school">
            <label>
              <span>Escola</span>
              <select name="school_id" id="futureSchoolSelect" required>
                <option value="">Selecione a escola</option>
                ${schools.results.map(s => `
                  <option value="${Number(s.id)}" ${selectedSchool === Number(s.id) ? 'selected' : ''}>
                    ${esc(s.name)}
                  </option>
                `).join('')}
              </select>
            </label>

            <label>
              <span>Prova</span>
              <select name="exam_id">
                <option value="">Todas as avaliações selecionadas</option>
                ${examOptions}
              </select>
            </label>
          </div>

          <div class="future-class-picker-head">
            <span>Turmas</span>
            <div>
              <button type="button" class="future-mini-button" id="selectVisibleClasses">Selecionar visíveis</button>
              <button type="button" class="future-mini-button" id="clearVisibleClasses">Desmarcar</button>
            </div>
          </div>

          <div class="future-class-filter-grid" id="futureClassFilterGrid">
            ${classCheckboxes || '<p class="muted">Nenhuma turma com resultados encontrada.</p>'}
          </div>

          <button type="submit" class="future-apply-filter">
            <span>◎</span>
            Mostrar alunos e resultados
            <i>→</i>
          </button>
        </form>

        ${selectedSchool && selectedClasses.length ? `
          <section class="future-selection-summary">
            <div>
              <span class="future-selection-icon">⌁</span>
              <div>
                <small>ESCOLA SELECIONADA</small>
                <b>${esc(schoolName)}</b>
              </div>
            </div>

            <div class="future-selection-numbers">
              <span><small>TURMAS</small><b>${selectedClasses.length}</b></span>
              <span><small>ALUNOS / RESULTADOS</small><b>${enriched.length}</b></span>
              <span><small>GRUPOS DE PROVA</small><b>${groups.size}</b></span>
            </div>
          </section>

          <div class="future-results-groups">
            ${groupHtml || `
              <div class="future-empty-result">
                <span>◎</span>
                <h2>Nenhum resultado encontrado</h2>
                <p>Tente outra turma ou retire o filtro de prova.</p>
              </div>`}
          </div>
        ` : `
          <section class="future-empty-result future-empty-start">
            <span>◎</span>
            <h2>Escolha a escola e pelo menos uma turma</h2>
            <p>Os alunos aparecerão organizados por turma e avaliação.</p>
          </section>
        `}
      </main>

      <script>
        const schoolSelect = document.getElementById('futureSchoolSelect');
        const classCards = [...document.querySelectorAll('.future-class-filter')];
        const selectVisible = document.getElementById('selectVisibleClasses');
        const clearVisible = document.getElementById('clearVisibleClasses');
        const clearAll = document.getElementById('clearStudentFilters');

        function updateVisibleClasses() {
          const schoolId = Number(schoolSelect?.value || 0);

          classCards.forEach(card => {
            const match = schoolId && Number(card.dataset.schoolId) === schoolId;
            card.style.display = match ? '' : 'none';

            if (!match && schoolId) {
              card.querySelector('input').checked = false;
            }
          });
        }

        if (schoolSelect) {
          schoolSelect.addEventListener('change', updateVisibleClasses);
        }

        if (selectVisible) {
          selectVisible.addEventListener('click', () => {
            classCards
              .filter(card => card.style.display !== 'none')
              .forEach(card => card.querySelector('input').checked = true);
          });
        }

        if (clearVisible) {
          clearVisible.addEventListener('click', () => {
            classCards
              .filter(card => card.style.display !== 'none')
              .forEach(card => card.querySelector('input').checked = false);
          });
        }

        if (clearAll) {
          clearAll.addEventListener('click', () => {
            location.href = '/alunos';
          });
        }

        updateVisibleClasses();
      </script>
    `
  );
}


async function finalAveragesPage(url, env) {
  await ensureRecoveryTables(env);

  const selectedSchool = Number(url.searchParams.get('school_id') || 0);
  const selectedClass = Number(url.searchParams.get('class_id') || 0);
  const selectedTrimester = Math.max(
    1,
    Math.min(3, Number(url.searchParams.get('trimester') || 1))
  );

  const schools = await env.DB.prepare(`
    SELECT id,name
    FROM schools
    WHERE active=1
    ORDER BY name COLLATE NOCASE
  `).all();

  const classes = await env.DB.prepare(`
    SELECT id,school_id,class_name,grade,shift
    FROM school_classes
    WHERE active=1
    ORDER BY school_id,shift,class_name COLLATE NOCASE
  `).all();

  let content = `
    <section class="final-average-empty">
      <span>★</span>
      <h2>Escolha escola e turma</h2>
      <p>Depois o sistema compara cada avaliação com sua recuperação e usa a maior nota.</p>
    </section>
  `;

  let selectedSchoolName = '';
  let selectedClassInfo = null;

  if (selectedSchool && selectedClass) {
    selectedSchoolName = schools.results.find(
      x => Number(x.id) === selectedSchool
    )?.name || '';

    selectedClassInfo = classes.results.find(
      x => Number(x.id) === selectedClass &&
           Number(x.school_id) === selectedSchool
    ) || null;

    if (selectedClassInfo) {
      const originals = await env.DB.prepare(`
        SELECT
          e.id,
          e.title,
          erl.recovery_exam_id,
          re.title AS recovery_title
        FROM exams e
        JOIN exam_context ec ON ec.exam_id=e.id
        LEFT JOIN exam_recovery_links erl
          ON erl.original_exam_id=e.id
        LEFT JOIN exams re
          ON re.id=erl.recovery_exam_id
        WHERE ec.school_class_id=?
          AND COALESCE(ec.trimester,0)=?
          AND e.id NOT IN (
            SELECT recovery_exam_id
            FROM exam_recovery_links
          )
        ORDER BY e.id
      `).bind(
        selectedClass,
        selectedTrimester
      ).all();

      const pairs = originals.results.map((row, index) => ({
        index: index + 1,
        originalId: Number(row.id),
        originalTitle: row.title,
        recoveryId: row.recovery_exam_id
          ? Number(row.recovery_exam_id)
          : null,
        recoveryTitle: row.recovery_title || ''
      }));

      const allExamIds = [
        ...pairs.map(x => x.originalId),
        ...pairs.map(x => x.recoveryId).filter(Boolean)
      ];

      const submissions = allExamIds.length
        ? await env.DB.prepare(`
            SELECT
              su.exam_id,
              su.student_name,
              su.percent
            FROM submissions su
            WHERE su.exam_id IN (${allExamIds.map(() => '?').join(',')})
            ORDER BY su.student_name COLLATE NOCASE, su.id
          `).bind(...allExamIds).all()
        : { results: [] };

      const studentMap = new Map();

      for (const row of submissions.results) {
        const key = String(row.student_name || '')
          .trim()
          .toLocaleLowerCase('pt-BR');

        if (!key) continue;

        if (!studentMap.has(key)) {
          studentMap.set(key, {
            name: String(row.student_name || '').trim(),
            grades: new Map()
          });
        }

        // Se houver algum resultado duplicado do mesmo aluno na mesma prova,
        // preserva o maior valor em vez de diminuir a nota.
        const current = studentMap.get(key).grades.get(Number(row.exam_id));
        const value = Number(row.percent || 0);

        if (current == null || value > current) {
          studentMap.get(key).grades.set(Number(row.exam_id), value);
        }
      }

      const students = [...studentMap.values()]
        .sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));

      const pairHeaders = pairs.map(pair => `
        <th>
          <div class="avg-pair-head">
            <b>A${pair.index}</b>
            <small>${esc(pair.originalTitle)}</small>
          </div>
        </th>
      `).join('');

      const rows = students.map(student => {
        let validCount = 0;
        let sumBest = 0;

        const pairCells = pairs.map(pair => {
          const original = student.grades.has(pair.originalId)
            ? Number(student.grades.get(pair.originalId))
            : null;

          const recovery = pair.recoveryId && student.grades.has(pair.recoveryId)
            ? Number(student.grades.get(pair.recoveryId))
            : null;

          const candidates = [original, recovery]
            .filter(v => v != null && Number.isFinite(v));

          const best = candidates.length
            ? Math.max(...candidates)
            : null;

          if (best != null) {
            validCount += 1;
            sumBest += best;
          }

          const winnerOriginal =
            best != null &&
            original != null &&
            original >= (recovery ?? -Infinity);

          const winnerRecovery =
            best != null &&
            recovery != null &&
            recovery > (original ?? -Infinity);

          return `
            <td>
              <div class="avg-pair-cell">
                <span class="${winnerOriginal ? 'avg-used' : ''}">
                  <small>Prova</small>
                  <b>${original == null ? '—' : formatPenaltyValue(original)}</b>
                </span>
                <span class="${winnerRecovery ? 'avg-used recovery' : ''}">
                  <small>Recup.</small>
                  <b>${recovery == null ? '—' : formatPenaltyValue(recovery)}</b>
                </span>
                <strong>
                  Maior: ${best == null ? '—' : formatPenaltyValue(best)}
                </strong>
              </div>
            </td>`;
        }).join('');

        const finalAverage = validCount >= 2
          ? Math.round((sumBest / validCount) * 10) / 10
          : null;

        return `
          <tr>
            <td class="avg-student-name">${esc(student.name)}</td>
            ${pairCells}
            <td>
              <div class="avg-final ${finalAverage == null ? 'pending' : finalAverage >= 60 ? 'good' : 'low'}">
                <small>${finalAverage == null ? 'AGUARDANDO' : 'MÉDIA FINAL'}</small>
                <b>${finalAverage == null ? '—' : formatPenaltyValue(finalAverage)}</b>
                <span>
                  ${finalAverage == null
                    ? `${validCount}/2 avaliações mínimas`
                    : `${validCount} maior(es) nota(s) utilizadas`}
                </span>
              </div>
            </td>
          </tr>`;
      }).join('');

      const pairCards = pairs.map(pair => `
        <article class="avg-assessment-card">
          <div>
            <span class="avg-assessment-code">A${pair.index}</span>
            <div>
              <b>${esc(pair.originalTitle)}</b>
              <small>Avaliação principal</small>
            </div>
          </div>

          <div class="avg-recovery-line">
            <span>↻</span>
            <div>
              <b>${pair.recoveryId ? esc(pair.recoveryTitle) : 'Recuperação pendente'}</b>
              <small>
                ${pair.recoveryId
                  ? 'A maior nota entre as duas será usada.'
                  : 'Abra a prova e crie sua recuperação.'}
              </small>
            </div>
          </div>
        </article>
      `).join('');

      content = `
        <section class="avg-rule-card">
          <span>⚖</span>
          <div>
            <b>Regra automática da média</b>
            <p>
              Para cada avaliação: <strong>vale a maior nota entre prova e recuperação.</strong>
              A média final é a soma dessas maiores notas dividida pelo número de avaliações válidas.
              O sistema exige pelo menos <strong>2 avaliações</strong>.
            </p>
          </div>
        </section>

        <section class="avg-assessment-grid">
          ${pairCards || `
            <div class="final-average-empty compact">
              <span>📝</span>
              <h2>Nenhuma avaliação encontrada</h2>
              <p>Crie pelo menos duas avaliações para esta turma e trimestre.</p>
            </div>
          `}
        </section>

        ${pairs.length < 2 ? `
          <div class="avg-minimum-warning">
            ⚠ Esta turma possui apenas <b>${pairs.length}</b> avaliação(ões).
            A média final será liberada quando houver pelo menos 2.
          </div>
        ` : ''}

        ${pairs.length ? `
          <section class="avg-table-card">
            <div class="avg-table-title">
              <div>
                <span class="eyebrow blue">ALUNOS</span>
                <h2>Melhores notas e média final</h2>
              </div>
              <div class="avg-legend">
                <span><i class="legend-main"></i> nota utilizada</span>
                <span><i class="legend-recovery"></i> recuperação utilizada</span>
              </div>
            </div>

            <div class="table-wrap">
              <table class="avg-final-table">
                <thead>
                  <tr>
                    <th>Aluno</th>
                    ${pairHeaders}
                    <th>Média</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || `
                    <tr>
                      <td colspan="${pairs.length + 2}">
                        Nenhum aluno respondeu às avaliações ainda.
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </section>
        ` : ''}
      `;
    }
  }

  const classOptions = classes.results.map(c => `
    <option value="${Number(c.id)}"
            data-school="${Number(c.school_id)}"
            ${selectedClass === Number(c.id) ? 'selected' : ''}>
      ${esc(c.class_name)} · ${esc(c.shift)} · ${esc(c.grade)}
    </option>
  `).join('');

  return page(
    'Médias finais',
    nav() + `
      <main class="final-average-page">
        <section class="final-average-hero">
          <div>
            <span class="eyebrow white">AVALIAÇÃO + RECUPERAÇÃO</span>
            <h1>Médias finais</h1>
            <p>A menor nota é ignorada. A maior prevalece automaticamente.</p>
          </div>
          <div class="avg-hero-formula">
            <small>FÓRMULA</small>
            <b>maior(Prova, Recuperação)</b>
            <span>→ média das maiores</span>
          </div>
        </section>

        <form method="get" class="avg-filter-card">
          <label>
            Escola
            <select name="school_id" id="avgSchool" required>
              <option value="">Selecione</option>
              ${schools.results.map(s => `
                <option value="${Number(s.id)}"
                        ${selectedSchool === Number(s.id) ? 'selected' : ''}>
                  ${esc(s.name)}
                </option>
              `).join('')}
            </select>
          </label>

          <label>
            Turma
            <select name="class_id" id="avgClass" required>
              <option value="">Selecione</option>
              ${classOptions}
            </select>
          </label>

          <label>
            Trimestre
            <select name="trimester">
              <option value="1" ${selectedTrimester === 1 ? 'selected' : ''}>1º trimestre</option>
              <option value="2" ${selectedTrimester === 2 ? 'selected' : ''}>2º trimestre</option>
              <option value="3" ${selectedTrimester === 3 ? 'selected' : ''}>3º trimestre</option>
            </select>
          </label>

          <button type="submit">Ver médias</button>
        </form>

        ${selectedClassInfo ? `
          <section class="avg-selected-context">
            <span>🏫</span>
            <div>
              <small>SELEÇÃO</small>
              <b>${esc(selectedSchoolName)} · ${esc(selectedClassInfo.class_name)} · ${selectedTrimester}º trimestre</b>
            </div>
          </section>
        ` : ''}

        ${content}
      </main>

      <script>
        const schoolSelect = document.getElementById('avgSchool');
        const classSelect = document.getElementById('avgClass');
        const classOptions = [...classSelect.querySelectorAll('option[data-school]')];

        function filterAvgClasses() {
          const school = Number(schoolSelect.value || 0);

          classOptions.forEach(option => {
            const visible = Number(option.dataset.school) === school;
            option.hidden = !visible;

            if (!visible && option.selected) {
              option.selected = false;
            }
          });
        }

        schoolSelect.addEventListener('change', filterAvgClasses);
        filterAvgClasses();
      </script>
    `
  );
}

async function globalResults(env) {
  const rows = await env.DB.prepare(`
    SELECT
      e.id,
      e.title,
      e.active,
      sc.name AS school_name,
      cl.shift AS shift,
      COALESCE(cl.class_name,e.class_name) AS class_name,
      COALESCE(cl.grade,e.grade) AS grade,
      ec.trimester AS trimester,
      COUNT(su.id) AS submissions,
      ROUND(AVG(su.percent),1) AS avg_percent,
      COALESCE(SUM(su.percent),0) AS percent_sum
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    LEFT JOIN submissions su ON su.exam_id=e.id
    GROUP BY e.id
    ORDER BY sc.name, cl.shift, class_name, ec.trimester, e.id DESC
  `).all();

  const groups = new Map();

  for (const r of rows.results) {
    const school = r.school_name || 'Sem escola definida';
    const shift = r.shift || 'Sem turno';
    const cls = r.class_name || 'Sem turma';

    if (!groups.has(school)) {
      groups.set(school, { submissions: 0, percentSum: 0, exams: 0, shifts: new Map() });
    }

    const sg = groups.get(school);
    sg.submissions += Number(r.submissions || 0);
    sg.percentSum += Number(r.percent_sum || 0);
    sg.exams += 1;

    if (!sg.shifts.has(shift)) {
      sg.shifts.set(shift, { submissions: 0, percentSum: 0, classes: new Map() });
    }

    const shiftGroup = sg.shifts.get(shift);
    shiftGroup.submissions += Number(r.submissions || 0);
    shiftGroup.percentSum += Number(r.percent_sum || 0);

    if (!shiftGroup.classes.has(cls)) shiftGroup.classes.set(cls, []);
    shiftGroup.classes.get(cls).push(r);
  }

  const formatAvg = (sum, total) =>
    total ? (sum / total).toFixed(1).replace('.', ',') : '—';

  const blocks = [...groups.entries()].map(([schoolName, sg]) => {
    const schoolAvg = formatAvg(sg.percentSum, sg.submissions);

    const shiftBlocks = [...sg.shifts.entries()].map(([shift, shiftGroup]) => {
      const shiftAvg = formatAvg(shiftGroup.percentSum, shiftGroup.submissions);

      const classCards = [...shiftGroup.classes.entries()].map(([cls, exams]) => {
        const total = exams.reduce((n, e) => n + Number(e.submissions || 0), 0);
        const sum = exams.reduce((n, e) => n + Number(e.percent_sum || 0), 0);
        const classAvg = formatAvg(sum, total);

        const examRows = exams.map(e => {
          const examAvg = e.avg_percent == null ? '—' : Number(e.avg_percent).toFixed(1).replace('.', ',');
          return `
            <a class="result-exam-row" href="/provas/${e.id}/resultados">
              <div>
                <span class="mini-chip">${e.trimester ? e.trimester + 'º TRI' : 'PROVA'}</span>
                <b>${esc(e.title)}</b>
                <small>${esc(e.grade || '')}</small>
              </div>
              <div class="result-numbers">
                <span><b>${e.submissions || 0}</b><small>respostas</small></span>
                <span><b>${examAvg}</b><small>média /100</small></span>
                <i>›</i>
              </div>
            </a>`;
        }).join('');

        return `
          <section class="result-class-card">
            <div class="result-class-head">
              <div>
                <span class="class-avatar">${esc(cls).slice(0,3)}</span>
                <div>
                  <b>Turma ${esc(cls)}</b>
                  <small>${esc(shift)} · ${exams.length} prova(s) · ${total} resposta(s)</small>
                </div>
              </div>
              <div class="class-average"><small>Média da turma /100</small><b>${classAvg}</b></div>
            </div>
            ${examRows}
          </section>`;
      }).join('');

      const shiftIcon = shift === 'Noturno' ? '🌙' : shift === 'Tarde' ? '☀️' : shift === 'Integral' ? '🕘' : '🌤️';

      return `
        <div class="result-shift">
          <div class="shift-title result-shift-title">
            <span class="shift-icon">${shiftIcon}</span>
            <div><span class="eyebrow">TURNO</span><h3>${esc(shift)}</h3></div>
            <div class="shift-average"><small>Média do turno /100</small><b>${shiftAvg}</b></div>
          </div>
          ${classCards}
        </div>`;
    }).join('');

    return `
      <details class="school-result-group" open>
        <summary>
          <div class="school-summary-main">
            <div class="school-icon v7"><span>🏫</span></div>
            <div>
              <span class="eyebrow blue">ESCOLA</span>
              <h2>${esc(schoolName)}</h2>
              <p>${sg.exams} prova(s) · ${sg.submissions} resposta(s)</p>
            </div>
          </div>
          <div class="school-average">
            <small>Média da escola /100</small><b>${schoolAvg}</b><span class="summary-chevron">›</span>
          </div>
        </summary>
        <div class="school-content">${shiftBlocks}</div>
      </details>`;
  }).join('');

  return page('Resultados gerais', nav() + `
    <main>
      <section class="results-header v7-results-hero">
        <div>
          <span class="eyebrow white">RESULTADOS PEDAGÓGICOS</span>
          <h1>Resultados por escola</h1>
          <p>Médias normalizadas de 0 a 100, organizadas por escola, turno, turma e prova.</p>
        </div>
        <a class="btn light" href="/">← Voltar ao painel</a>
      </section>
      <div class="section-heading">
        <span class="eyebrow blue">VISÃO ORGANIZADA</span>
        <h2>Escola → turno → turma → prova</h2>
        <p>As questões podem ser sorteadas; os resultados continuam vinculados à turma correta.</p>
      </div>
      <div class="school-list">
        ${blocks || '<div class="card empty-state"><h2>Ainda não há resultados</h2><p>Os resultados aparecerão aqui quando os alunos enviarem as provas.</p></div>'}
      </div>
    </main>`);
}



async function gradebookRco(env) {
  const rows = await env.DB.prepare(`
    SELECT
      e.id AS exam_id,
      e.title AS exam_title,
      COALESCE(ec.trimester,0) AS trimester,
      COALESCE(sc.name,'Sem escola definida') AS school_name,
      COALESCE(cl.shift,'Sem turno') AS shift,
      COALESCE(cl.class_name,e.class_name,su.student_class,'Sem turma') AS class_name,
      COALESCE(cl.grade,e.grade,'') AS grade,
      su.student_name,
      su.percent
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    ORDER BY
      school_name,
      shift,
      class_name,
      trimester,
      e.id,
      su.student_name COLLATE NOCASE
  `).all();

  const hierarchy = new Map();

  for (const r of rows.results) {
    const school = r.school_name || 'Sem escola definida';
    const shift = r.shift || 'Sem turno';
    const cls = r.class_name || 'Sem turma';
    const tri = Number(r.trimester || 0) || 0;

    if (!hierarchy.has(school)) hierarchy.set(school, new Map());
    const schoolMap = hierarchy.get(school);

    if (!schoolMap.has(shift)) schoolMap.set(shift, new Map());
    const shiftMap = schoolMap.get(shift);

    if (!shiftMap.has(cls)) {
      shiftMap.set(cls, { grade: r.grade || '', trimesters: new Map() });
    }

    const classData = shiftMap.get(cls);

    if (!classData.trimesters.has(tri)) {
      classData.trimesters.set(tri, {
        exams: new Map(),
        students: new Map()
      });
    }

    const triData = classData.trimesters.get(tri);

    if (!triData.exams.has(Number(r.exam_id))) {
      triData.exams.set(Number(r.exam_id), {
        id: Number(r.exam_id),
        title: r.exam_title || `Prova ${r.exam_id}`
      });
    }

    const normalized = String(r.student_name || '')
      .trim()
      .toLocaleLowerCase('pt-BR');

    if (!triData.students.has(normalized)) {
      triData.students.set(normalized, {
        name: String(r.student_name || '').trim(),
        grades: new Map()
      });
    }

    triData.students.get(normalized).grades.set(
      Number(r.exam_id),
      Number(r.percent || 0)
    );
  }

  const noteText = value => {
    if (value == null || Number.isNaN(Number(value))) return '';
    const n = Math.round(Number(value) * 10) / 10;
    return Number.isInteger(n)
      ? String(n)
      : n.toFixed(1).replace('.', ',');
  };

  const triTitle = tri =>
    tri === 1 ? '1º TRIMESTRE' :
    tri === 2 ? '2º TRIMESTRE' :
    tri === 3 ? '3º TRIMESTRE' :
    'SEM TRIMESTRE';

  const triIcon = tri =>
    tri === 1 ? '①' :
    tri === 2 ? '②' :
    tri === 3 ? '③' : '•';

  let schoolIndex = 0;

  const schoolBlocks = [...hierarchy.entries()].map(([schoolName, schoolMap]) => {
    schoolIndex += 1;
    const theme = ((schoolIndex - 1) % 5) + 1;

    const shiftBlocks = [...schoolMap.entries()].map(([shift, shiftMap]) => {
      const shiftIcon =
        shift === 'Noturno' ? '🌙' :
        shift === 'Tarde' ? '☀️' :
        shift === 'Integral' ? '🕘' : '🌤️';

      const classBlocks = [...shiftMap.entries()].map(([cls, classData], classIndex) => {
        const trimesterPanels = [...classData.trimesters.entries()]
          .sort((a,b) => Number(a[0]) - Number(b[0]))
          .map(([tri, triData]) => {
          const exams = [...triData.exams.values()];
          const students = [...triData.students.values()]
            .sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));

          const studentRows = students.map((student, idx) => {
            const values = exams
              .map(exam => student.grades.has(exam.id) ? student.grades.get(exam.id) : null);

            const valid = values.filter(v => v != null && !Number.isNaN(Number(v)));
            const average = valid.length
              ? valid.reduce((a,b) => a + Number(b), 0) / valid.length
              : null;

            const examCells = exams.map(exam => {
              const val = student.grades.has(exam.id)
                ? student.grades.get(exam.id)
                : null;

              if (val == null) return `<td><span class="rco-missing">—</span></td>`;

              const clsNote = Number(val) >= 60 ? 'rco-note-blue' : 'rco-note-red';
              return `<td><span class="rco-note ${clsNote}">${noteText(val)}</span></td>`;
            }).join('');

            const avgClass = average == null
              ? ''
              : Number(average) >= 60 ? 'rco-note-blue' : 'rco-note-red';

            return `
              <tr>
                <td class="rco-student-number">${idx + 1}</td>
                <td class="rco-student-name">${esc(student.name)}</td>
                ${examCells}
                <td class="rco-average-cell">
                  ${average == null
                    ? '<span class="rco-missing">—</span>'
                    : `<span class="rco-note rco-average-note ${avgClass}">${noteText(average)}</span>`}
                </td>
              </tr>`;
          }).join('');

          const classSafe = `rco_${schoolIndex}_${classIndex}_${tri}`;

          const namesAndAverage = students.map(student => {
            const values = exams
              .map(exam => student.grades.has(exam.id) ? student.grades.get(exam.id) : null)
              .filter(v => v != null && !Number.isNaN(Number(v)));
            const avg = values.length
              ? values.reduce((a,b) => a + Number(b), 0) / values.length
              : null;
            return `${student.name}\t${avg == null ? '' : noteText(avg)}`;
          }).join('\n');

          const onlyAverage = students.map(student => {
            const values = exams
              .map(exam => student.grades.has(exam.id) ? student.grades.get(exam.id) : null)
              .filter(v => v != null && !Number.isNaN(Number(v)));
            const avg = values.length
              ? values.reduce((a,b) => a + Number(b), 0) / values.length
              : null;
            return avg == null ? '' : noteText(avg);
          }).join('\n');

          const examCopyButtons = exams.map(exam => {
            const copyId = `${classSafe}_exam_${exam.id}`;
            const text = students.map(student => {
              const val = student.grades.has(exam.id)
                ? student.grades.get(exam.id)
                : null;
              return `${student.name}\t${val == null ? '' : noteText(val)}`;
            }).join('\n');

            return `
              <textarea class="copy-source" id="${copyId}">${esc(text)}</textarea>
              <button type="button" class="rco-copy-chip" onclick="copyRco('${copyId}',this)">
                ⧉ ${esc(exam.title)}
              </button>`;
          }).join('');

          return `
            <section class="rco-trimester tri-${tri}">
              <div class="rco-tri-head">
                <div>
                  <span class="rco-tri-number">${triIcon(tri)}</span>
                  <div>
                    <small>TRIMESTRE</small>
                    <h4>${triTitle(tri)}</h4>
                    <p>${students.length} aluno(s) · ${exams.length} prova(s)</p>
                  </div>
                </div>

                <div class="rco-main-copy">
                  <textarea class="copy-source" id="${classSafe}_names_avg">${esc(namesAndAverage)}</textarea>
                  <textarea class="copy-source" id="${classSafe}_avg">${esc(onlyAverage)}</textarea>
                  <button type="button" class="btn small rco-copy-primary"
                          onclick="copyRco('${classSafe}_names_avg',this)">
                    📋 Nome + média
                  </button>
                  <button type="button" class="btn small secondary"
                          onclick="copyRco('${classSafe}_avg',this)">
                    Só médias
                  </button>
                </div>
              </div>

              <div class="rco-exam-copy-row">
                <span>Copiar prova para o RCO:</span>
                ${examCopyButtons}
              </div>

              <div class="rco-table-wrap">
                <table class="rco-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Aluno</th>
                      ${exams.map(exam => `
                        <th>
                          <span>${esc(exam.title)}</span>
                          <small>${tri}º tri</small>
                        </th>`).join('')}
                      <th class="rco-average-head">Média TRI</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${studentRows}
                  </tbody>
                </table>
              </div>
            </section>`;
        }).join('');

        const exportKey = `${schoolName}|||${shift}|||${cls}`;

        return `
          <details class="rco-class-card" open data-export-key="${attr(exportKey)}">
            <summary>
              <label class="rco-select-class" onclick="event.stopPropagation()">
                <input type="checkbox"
                       class="rco-class-export-check"
                       value="${attr(exportKey)}"
                       data-school="${attr(schoolName)}"
                       checked>
                <span>✓</span>
              </label>
              <div class="rco-class-left">
                <span class="rco-class-badge">${esc(cls).slice(0,4)}</span>
                <div>
                  <span class="eyebrow">TURMA</span>
                  <h3>${esc(cls)}</h3>
                  <p>${esc(classData.grade || '')} · ${esc(shift)}</p>
                </div>
              </div>
              <span class="summary-chevron">›</span>
            </summary>
            <div class="rco-class-content">
              ${trimesterPanels}
            </div>
          </details>`;
      }).join('');

      return `
        <section class="rco-shift-block">
          <div class="rco-shift-head">
            <span class="rco-shift-icon">${shiftIcon}</span>
            <div>
              <span class="eyebrow">TURNO</span>
              <h3>${esc(shift)}</h3>
            </div>
          </div>
          ${classBlocks}
        </section>`;
    }).join('');

    return `
      <details class="rco-school-card school-theme-${theme}" open data-school-name="${attr(schoolName)}">
        <summary>
          <label class="rco-select-school" onclick="event.stopPropagation()">
            <input type="checkbox"
                   class="rco-school-export-check"
                   data-school="${attr(schoolName)}"
                   checked>
            <span>✓</span>
          </label>
          <div class="rco-school-main">
            <span class="rco-school-icon">🏫</span>
            <div>
              <span class="eyebrow">ESCOLA</span>
              <h2>${esc(schoolName)}</h2>
              <p>Turmas e notas organizadas por trimestre</p>
            </div>
          </div>
          <span class="summary-chevron">›</span>
        </summary>
        <div class="rco-school-content">${shiftBlocks}</div>
      </details>`;
  }).join('');

  return page('Caderno RCO', nav() + `
    <main class="rco-page">
      <section class="rco-hero">
        <div>
          <span class="eyebrow white">CADERNO DIGITAL</span>
          <h1>Notas organizadas para o RCO</h1>
          <p>Escola → turno → turma → 1º, 2º e 3º trimestre → provas → alunos.</p>
        </div>
        <div class="rco-hero-actions">
          <a class="btn light" href="/">← Painel</a>
          <a class="btn glass" href="/resultados">Resultados gerais</a>
        </div>
      </section>

      <section class="rco-help-strip">
        <div><span>🏫</span><b>Escola</b><small>cada colégio separado</small></div>
        <div><span>👥</span><b>Turma</b><small>alunos em ordem alfabética</small></div>
        <div><span>①②③</span><b>Trimestres</b><small>provas ficam juntas</small></div>
        <div><span>📋</span><b>RCO</b><small>cópia em um toque</small></div>
      </section>

      <section class="card rco-export-panel">
        <div class="rco-export-main">
          <span class="rco-export-icon">▦</span>
          <div>
            <span class="eyebrow blue">PLANILHA DE NOTAS</span>
            <h2>Baixar escolas e turmas selecionadas</h2>
            <p>Use as caixas ✓ nas escolas ou turmas e baixe somente o que precisa para o RCO.</p>
          </div>
        </div>

        <div class="rco-export-actions">
          <button type="button" class="btn small secondary" id="selectAllRco">Selecionar tudo</button>
          <button type="button" class="btn small secondary" id="clearAllRco">Limpar seleção</button>
          <button type="button" class="btn rco-download-sheet" id="downloadRcoSheet">
            ⬇ Baixar planilha
          </button>
        </div>

        <div class="rco-export-status" id="rcoExportStatus">
          Todas as turmas estão selecionadas.
        </div>
      </section>

      <div class="rco-toolbar card">
        <div>
          <span class="eyebrow blue">LOCALIZAR RAPIDAMENTE</span>
          <h2>Buscar no caderno</h2>
        </div>
        <div class="search-box rco-search">
          <span>⌕</span>
          <input id="rcoSearch" placeholder="Digite escola, turma ou turno">
        </div>
      </div>

      <div id="rcoBook">
        ${schoolBlocks || `
          <div class="card empty-state">
            <div class="empty-icon">📘</div>
            <h2>Ainda não há notas</h2>
            <p>Quando os alunos concluírem as provas, o caderno será montado automaticamente.</p>
          </div>`}
      </div>
    </main>

    <div id="copyToast" class="copy-toast">✓ Copiado para a área de transferência</div>

    <script>
      async function copyRco(id, button) {
        const source = document.getElementById(id);
        if (!source) return;

        try {
          await navigator.clipboard.writeText(source.value);
          const old = button.innerHTML;
          button.innerHTML = '✓ Copiado';
          button.classList.add('copied');
          showCopyToast();
          setTimeout(() => {
            button.innerHTML = old;
            button.classList.remove('copied');
          }, 1600);
        } catch (e) {
          source.style.display = 'block';
          source.select();
          document.execCommand('copy');
          source.style.display = 'none';
          showCopyToast();
        }
      }

      function showCopyToast() {
        const toast = document.getElementById('copyToast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1600);
      }

      const classExportChecks =
        [...document.querySelectorAll('.rco-class-export-check')];

      const schoolExportChecks =
        [...document.querySelectorAll('.rco-school-export-check')];

      const exportStatus = document.getElementById('rcoExportStatus');
      const selectAllRco = document.getElementById('selectAllRco');
      const clearAllRco = document.getElementById('clearAllRco');
      const downloadRcoSheet = document.getElementById('downloadRcoSheet');

      function updateRcoExportStatus() {
        schoolExportChecks.forEach(schoolCheck => {
          const school = schoolCheck.dataset.school;
          const classes = classExportChecks.filter(
            c => c.dataset.school === school
          );

          const checked = classes.filter(c => c.checked).length;
          schoolCheck.checked = classes.length > 0 && checked === classes.length;
          schoolCheck.indeterminate = checked > 0 && checked < classes.length;
        });

        const selected = classExportChecks.filter(c => c.checked);

        if (!selected.length) {
          exportStatus.className = 'rco-export-status warning';
          exportStatus.innerHTML =
            '<b>Nenhuma turma selecionada.</b> Marque ao menos uma para baixar.';
        } else {
          const schools = new Set(
            selected.map(c => c.dataset.school)
          );

          exportStatus.className = 'rco-export-status ok';
          exportStatus.innerHTML =
            '<b>' + selected.length + ' turma(s)</b> em ' +
            schools.size + ' escola(s) selecionada(s).';
        }

        return selected;
      }

      schoolExportChecks.forEach(check => {
        check.addEventListener('change', () => {
          const school = check.dataset.school;

          classExportChecks
            .filter(c => c.dataset.school === school)
            .forEach(c => c.checked = check.checked);

          updateRcoExportStatus();
        });
      });

      classExportChecks.forEach(check => {
        check.addEventListener('change', updateRcoExportStatus);
      });

      if (selectAllRco) {
        selectAllRco.addEventListener('click', () => {
          classExportChecks.forEach(c => c.checked = true);
          updateRcoExportStatus();
        });
      }

      if (clearAllRco) {
        clearAllRco.addEventListener('click', () => {
          classExportChecks.forEach(c => c.checked = false);
          updateRcoExportStatus();
        });
      }

      if (downloadRcoSheet) {
        downloadRcoSheet.addEventListener('click', () => {
          const selected = updateRcoExportStatus();

          if (!selected.length) {
            alert('Selecione pelo menos uma turma para baixar a planilha.');
            return;
          }

          const params = new URLSearchParams();

          selected.forEach(c => {
            params.append('class_key', c.value);
          });

          location.href = '/caderno/planilha?' + params.toString();
        });
      }

      updateRcoExportStatus();

      const rcoSearch = document.getElementById('rcoSearch');
      if (rcoSearch) {
        rcoSearch.addEventListener('input', () => {
          const term = rcoSearch.value.trim().toLowerCase();

          document.querySelectorAll('.rco-school-card').forEach(school => {
            const schoolText = school.innerText.toLowerCase();
            school.style.display = !term || schoolText.includes(term) ? '' : 'none';
          });
        });
      }
    </script>
  `);
}


async function gradebookSpreadsheet(url, env) {
  const selectedKeys = url.searchParams
    .getAll('class_key')
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 100);

  if (!selectedKeys.length) {
    return page(
      'Planilha RCO',
      nav() + `
        <main>
          <div class="card">
            <h2>Selecione pelo menos uma turma.</h2>
            <a class="btn" href="/caderno">Voltar ao Caderno RCO</a>
          </div>
        </main>
      `,
      400
    );
  }

  const rows = await env.DB.prepare(`
    SELECT
      COALESCE(sc.name,'Sem escola definida') AS school_name,
      COALESCE(cl.shift,'Sem turno') AS shift,
      COALESCE(cl.class_name,e.class_name,su.student_class,'Sem turma') AS class_name,
      COALESCE(cl.grade,e.grade,'') AS grade,
      COALESCE(ec.trimester,0) AS trimester,
      e.title AS exam_title,
      su.student_name,
      su.percent,
      su.duration_seconds,
      su.submitted_at
    FROM submissions su
    JOIN exams e ON e.id=su.exam_id
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    ORDER BY
      school_name,
      shift,
      class_name,
      trimester,
      e.id,
      su.student_name COLLATE NOCASE
  `).all();

  const selected = new Set(selectedKeys);

  const filtered = rows.results.filter(r => {
    const key = `${r.school_name}|||${r.shift}|||${r.class_name}`;
    return selected.has(key);
  });

  const noteText = value => {
    const n = Number(value || 0);
    return n.toFixed(1).replace('.0','').replace('.', ',');
  };

  const timeText = seconds => {
    const total = Math.max(0, Math.round(Number(seconds || 0)));
    if (!total) return '';
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return sec ? `${min}min ${String(sec).padStart(2,'0')}s` : `${min}min`;
  };

  const header = [
    'Escola',
    'Turno',
    'Turma',
    'Série',
    'Trimestre',
    'Prova',
    'Aluno',
    'Nota /100',
    'Tempo utilizado',
    'Enviado em'
  ];

  const lines = [header.map(csvSafe).join(';')];

  for (const r of filtered) {
    lines.push([
      r.school_name,
      r.shift,
      r.class_name,
      r.grade,
      r.trimester ? `${r.trimester}º` : '',
      r.exam_title,
      r.student_name,
      noteText(r.percent),
      timeText(r.duration_seconds),
      r.submitted_at || ''
    ].map(csvSafe).join(';'));
  }

  const now = new Date().toISOString().slice(0,10);

  return new Response(
    '\ufeff' + lines.join('\n'),
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="notas_rco_${now}.csv"`
      }
    }
  );
}


async function cleanupRepetitiveQuestionsPage(env, message = '') {
  const matchWhere = `
    (
      lower(trim(q.statement)) LIKE 'em uma atividade do%'
      OR lower(trim(q.statement)) LIKE 'em uma aula d%'
    )
  `;

  const total = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM questions q
    WHERE q.active=1 AND ${matchWhere}
  `).first();

  const linked = await env.DB.prepare(`
    SELECT COUNT(DISTINCT q.id) AS c
    FROM questions q
    JOIN exam_questions eq ON eq.question_id=q.id
    WHERE q.active=1 AND ${matchWhere}
  `).first();

  return page(
    'Limpar questões repetitivas',
    nav() + `
      <main class="student reset-page">
        <section class="reset-card">
          <div class="reset-icon">🧹</div>
          <span class="eyebrow red-text">LIMPEZA DO BANCO DE QUESTÕES</span>
          <h1>Excluir enunciados antigos</h1>
          <p class="reset-lead">
            Esta ferramenta localiza questões de qualquer série que começam por
            <b>“Em uma atividade do...”</b> ou <b>“Em uma aula da/do/de...”</b>.
          </p>

          ${message ? `<div class="reset-success">${esc(message)}</div>` : ''}

          <div class="reset-summary">
            <div><small>Questões localizadas</small><b>${Number(total?.c || 0)}</b></div>
            <div><small>Já usadas em provas</small><b>${Number(linked?.c || 0)}</b></div>
          </div>

          <div class="reset-warning">
            <b>Como a limpeza funciona</b>
            <p>As questões não usadas em nenhuma prova são apagadas definitivamente. Se alguma já estiver ligada a uma prova existente, ela será desativada do banco para preservar a prova e o resultado antigo.</p>
          </div>

          <div class="reset-safe">
            <b>O que não será afetado</b>
            <p>As novas questões humanizadas, escolas, turmas, resultados e demais questões permanecem no sistema.</p>
          </div>

          <form method="post" action="/banco/limpar-repetitivas" class="reset-form"
                onsubmit="return confirm('Confirma a limpeza das questões com esses enunciados antigos?');">
            <label>
              Para confirmar, digite <b>EXCLUIR</b>
              <input name="confirm_text" autocomplete="off" placeholder="Digite EXCLUIR" required>
            </label>
            <button class="danger-button" type="submit">🧹 Excluir questões repetitivas</button>
            <a class="btn secondary" href="/banco">Cancelar e voltar</a>
          </form>
        </section>
      </main>
    `
  );
}

async function cleanupRepetitiveQuestions(request, env) {
  const f = await request.formData();
  const confirmText = String(f.get('confirm_text') || '').trim().toUpperCase();

  if (confirmText !== 'EXCLUIR') {
    return cleanupRepetitiveQuestionsPage(env, 'Nada foi excluído. Digite exatamente EXCLUIR para confirmar.');
  }

  const before = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM questions
    WHERE active=1
      AND (
        lower(trim(statement)) LIKE 'em uma atividade do%'
        OR lower(trim(statement)) LIKE 'em uma aula d%'
      )
  `).first();

  // Primeiro tira todas as questões correspondentes do banco ativo.
  await env.DB.prepare(`
    UPDATE questions
    SET active=0
    WHERE active=1
      AND (
        lower(trim(statement)) LIKE 'em uma atividade do%'
        OR lower(trim(statement)) LIKE 'em uma aula d%'
      )
  `).run();

  // Depois apaga fisicamente as que nunca foram utilizadas em uma prova.
  await env.DB.prepare(`
    DELETE FROM questions
    WHERE active=0
      AND (
        lower(trim(statement)) LIKE 'em uma atividade do%'
        OR lower(trim(statement)) LIKE 'em uma aula d%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM exam_questions eq
        WHERE eq.question_id=questions.id
      )
  `).run();

  await ensureQuestionImageTable(env);

  await env.DB.prepare(`
    DELETE FROM question_images
    WHERE NOT EXISTS (
      SELECT 1
      FROM questions q
      WHERE q.id=question_images.question_id
    )
  `).run();

  const removed = Number(before?.c || 0);

  return page(
    'Limpeza concluída',
    nav() + `
      <main class="student reset-page">
        <section class="reset-card success-reset">
          <div class="success">✓</div>
          <span class="eyebrow blue">BANCO ATUALIZADO</span>
          <h1>Questões repetitivas removidas</h1>
          <p><b>${removed}</b> questão(ões) deixaram de aparecer no banco ativo e não serão mais sorteadas em novas provas.</p>
          <div class="reset-safe">
            <b>Banco preservado</b>
            <p>Questões humanizadas e demais conteúdos permaneceram ativos.</p>
          </div>
          <div class="form-actions">
            <a class="btn" href="/banco">Voltar ao banco</a>
            <a class="btn secondary" href="/">Ir ao painel</a>
          </div>
        </section>
      </main>
    `
  );
}


async function ensureQuestionImageTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS question_images (
      question_id INTEGER PRIMARY KEY,
      mime_type TEXT NOT NULL,
      image_data BLOB NOT NULL,
      alt_text TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    )
  `).run();
}

function questionImageMime(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();

  if (type === 'image/jpeg' || /\.jpe?g$/.test(name)) return 'image/jpeg';
  if (type === 'image/png' || /\.png$/.test(name)) return 'image/png';
  if (type === 'image/webp' || /\.webp$/.test(name)) return 'image/webp';

  return '';
}

async function readQuestionImage(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || Number(file.size || 0) === 0) {
    return null;
  }

  const mimeType = questionImageMime(file);

  if (!mimeType) {
    throw new Error('Use uma imagem JPG, PNG ou WebP.');
  }

  const maxBytes = 1500000;

  if (Number(file.size || 0) > maxBytes) {
    throw new Error('A imagem deve ter no máximo 1,5 MB.');
  }

  const buffer = await file.arrayBuffer();

  if (buffer.byteLength > maxBytes) {
    throw new Error('A imagem deve ter no máximo 1,5 MB.');
  }

  return {
    mimeType,
    bytes: new Uint8Array(buffer)
  };
}

async function upsertQuestionImage(env, questionId, image, altText = '') {
  await ensureQuestionImageTable(env);

  await env.DB.prepare(`
    INSERT INTO question_images
      (question_id,mime_type,image_data,alt_text,updated_at)
    VALUES
      (?,?,?,?,?)
    ON CONFLICT(question_id)
    DO UPDATE SET
      mime_type=excluded.mime_type,
      image_data=excluded.image_data,
      alt_text=excluded.alt_text,
      updated_at=excluded.updated_at
  `).bind(
    Number(questionId),
    image.mimeType,
    image.bytes,
    String(altText || '').trim(),
    Math.floor(Date.now() / 1000)
  ).run();
}

async function questionImageResponse(env, questionId) {
  await ensureQuestionImageTable(env);

  const image = await env.DB.prepare(`
    SELECT mime_type,image_data,updated_at
    FROM question_images
    WHERE question_id=?
  `).bind(questionId).first();

  if (!image) {
    return new Response('Imagem não encontrada.', { status: 404 });
  }

  const bytes = image.image_data instanceof Uint8Array
    ? image.image_data
    : new Uint8Array(image.image_data || []);

  return new Response(bytes, {
    headers: {
      'Content-Type': image.mime_type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=120, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function questionImageEditor(env, questionId, message = '', isError = false) {
  await ensureQuestionImageTable(env);

  const q = await env.DB.prepare(`
    SELECT id,grade,trimester,topic,statement
    FROM questions
    WHERE id=?
  `).bind(questionId).first();

  if (!q) {
    return page(
      'Questão não encontrada',
      nav() + '<main><div class="card"><h2>Questão não encontrada.</h2><a class="btn" href="/banco">Voltar</a></div></main>',
      404
    );
  }

  const image = await env.DB.prepare(`
    SELECT mime_type,alt_text,LENGTH(image_data) AS image_bytes,updated_at
    FROM question_images
    WHERE question_id=?
  `).bind(questionId).first();

  const kb = image?.image_bytes
    ? Math.round(Number(image.image_bytes) / 1024)
    : 0;

  return page(
    'Imagem da questão',
    nav() + `
      <main class="question-image-page">
        <div class="hero">
          <div>
            <span class="eyebrow white">QUESTÃO #${q.id}</span>
            <h1>Imagem da questão</h1>
            <p>${esc(q.grade)} · ${q.trimester ? q.trimester + 'º trimestre' : 'Geral'} · ${esc(q.topic)}</p>
          </div>
          <a class="btn light" href="/banco">← Banco de questões</a>
        </div>

        ${message ? `
          <div class="${isError ? 'alert' : 'question-image-success'}">
            ${esc(message)}
          </div>` : ''}

        <section class="question-image-editor-grid">
          <div class="card">
            <span class="eyebrow blue">ENUNCIADO</span>
            <h2>${esc(q.statement)}</h2>

            <div class="bank-photo-layout-note">
            📷 <b>Novo layout visual:</b> esta foto aparecerá automaticamente em destaque
            na questão quando o aluno fizer a prova.
          </div>
          <div class="question-image-current">
              ${image ? `
                <img src="/imagem/q/${q.id}?v=${image.updated_at || 0}"
                     alt="${attr(image.alt_text || 'Imagem relacionada à questão')}">
                <div>
                  <b>Imagem atual</b>
                  <small>${esc(image.mime_type)} · aproximadamente ${kb} KB</small>
                  ${image.alt_text ? `<p>${esc(image.alt_text)}</p>` : ''}
                </div>
              ` : `
                <div class="question-image-placeholder">
                  <span>🖼️</span>
                  <b>Esta questão ainda não tem imagem</b>
                  <small>A imagem é opcional.</small>
                </div>
              `}
            </div>
          </div>

          <div class="card">
            <span class="eyebrow blue">${image ? 'TROCAR IMAGEM' : 'ADICIONAR IMAGEM'}</span>
            <h2>Deixar a questão mais visual</h2>
            <p class="muted">Aceita JPG, PNG ou WebP, com até 1,5 MB.</p>

            <form method="post" enctype="multipart/form-data" class="question-image-form">
              <input type="hidden" name="action" value="save">

              <label class="question-image-drop">
                <span>🖼️</span>
                <b>Escolher imagem do celular</b>
                <small>Toque aqui para selecionar</small>
                <input id="imageEditorFile"
                       type="file"
                       name="question_image"
                       accept="image/jpeg,image/png,image/webp"
                       required>
              </label>

              <div id="imageEditorPreview" class="question-image-preview" style="display:none">
                <img id="imageEditorPreviewImg" alt="Pré-visualização">
              </div>

              <label>
                Descrição da imagem
                <input name="image_alt"
                       value="${attr(image?.alt_text || '')}"
                       placeholder="Ex.: jogador de voleibol realizando um bloqueio">
                <small>Ajuda a identificar o conteúdo da imagem e melhora a acessibilidade.</small>
              </label>

              <button>✓ Salvar imagem</button>
            </form>

            ${image ? `
              <form method="post"
                    class="question-image-remove"
                    onsubmit="return confirm('Remover a imagem desta questão? A questão continuará no banco.');">
                <input type="hidden" name="action" value="remove">
                <button class="delete-exam-button">🗑 Remover imagem</button>
              </form>
            ` : ''}
          </div>
        </section>
      </main>

      <script>
        const fileInput = document.getElementById('imageEditorFile');
        const preview = document.getElementById('imageEditorPreview');
        const previewImg = document.getElementById('imageEditorPreviewImg');

        if (fileInput) {
          fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];

            if (!file) {
              preview.style.display = 'none';
              return;
            }

            if (file.size > 1500000) {
              alert('A imagem deve ter no máximo 1,5 MB.');
              fileInput.value = '';
              preview.style.display = 'none';
              return;
            }

            previewImg.src = URL.createObjectURL(file);
            preview.style.display = 'block';
          });
        }
      </script>
    `
  );
}

async function saveQuestionImage(request, env, questionId) {
  await ensureQuestionImageTable(env);

  const q = await env.DB.prepare(
    'SELECT id FROM questions WHERE id=?'
  ).bind(questionId).first();

  if (!q) {
    return page(
      'Questão não encontrada',
      nav() + '<main><div class="card"><h2>Questão não encontrada.</h2><a class="btn" href="/banco">Voltar</a></div></main>',
      404
    );
  }

  const f = await request.formData();
  const action = String(f.get('action') || 'save');

  if (action === 'remove') {
    await env.DB.prepare(
      'DELETE FROM question_images WHERE question_id=?'
    ).bind(questionId).run();

    return questionImageEditor(env, questionId, 'Imagem removida com sucesso.');
  }

  try {
    const image = await readQuestionImage(f.get('question_image'));

    if (!image) {
      return questionImageEditor(env, questionId, 'Selecione uma imagem.', true);
    }

    await upsertQuestionImage(
      env,
      questionId,
      image,
      f.get('image_alt') || ''
    );

    return questionImageEditor(env, questionId, 'Imagem salva com sucesso.');
  } catch (e) {
    return questionImageEditor(
      env,
      questionId,
      e.message || 'Não foi possível salvar a imagem.',
      true
    );
  }
}

async function bank(env) {
  await ensureQuestionImageTable(env);

  const repetitive = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM questions
    WHERE active=1
      AND (
        lower(trim(statement)) LIKE 'em uma atividade do%'
        OR lower(trim(statement)) LIKE 'em uma aula d%'
      )
  `).first();

  const qs = await env.DB.prepare(`
    SELECT
      q.*,
      CASE WHEN qi.question_id IS NULL THEN 0 ELSE 1 END AS has_image,
      COALESCE(qi.alt_text,'') AS image_alt,
      qi.updated_at AS image_updated_at
    FROM questions q
    LEFT JOIN question_images qi ON qi.question_id=q.id
    WHERE q.active=1
    ORDER BY q.id DESC
  `).all();

  const sources = await env.DB.prepare(`
    SELECT DISTINCT source AS name
    FROM questions
    WHERE active=1 AND source IS NOT NULL AND TRIM(source)<>''
    ORDER BY source
  `).all();

  const sourceOptions = sources.results
    .map(s => `<option>${esc(s.name)}</option>`)
    .join('');

  const rows = qs.results.map(q => `
    <tr id="q-${q.id}">
      <td>${q.id}</td>
      <td>${esc(q.grade)}</td>
      <td>${esc(q.trimester ? q.trimester + 'º' : 'Geral')}</td>
      <td>${esc(q.source || 'Autoral')}</td>
      <td>${esc(q.topic)}</td>
      <td>${esc(q.difficulty || 'Média')}</td>
      <td class="bank-question-cell">
        <span>${esc(q.statement)}</span>
        ${q.has_image ? `<small class="bank-image-tag">🖼️ Com imagem</small>` : ''}
      </td>
      <td class="bank-image-cell">
        ${q.has_image ? `
          <a href="/banco/imagem/${q.id}" class="bank-image-link">
            <img class="bank-thumb"
                 src="/imagem/q/${q.id}?v=${q.image_updated_at || 0}"
                 alt="${attr(q.image_alt || 'Imagem da questão')}">
            <span>Trocar</span>
          </a>
        ` : `
          <a href="/banco/imagem/${q.id}" class="bank-add-image">＋ Imagem</a>
        `}
      </td>
      <td><b>${q.correct}</b></td>
    </tr>
  `).join('');

  return page(
    'Banco de questões',
    nav() + `
      <main>
        <div class="hero">
          <div>
            <h1>Banco de Questões</h1>
            <p>Organize por fonte, trimestre, assunto, dificuldade e habilidade.</p>
          </div>
          <a class="btn secondary" href="/">← Painel</a>
        </div>

        <div class="card cleanup-bank-card">
          <div class="cleanup-bank-main">
            <div>
              <span class="eyebrow red-text">LIMPEZA DO BANCO</span>
              <h2>Excluir questões com enunciado repetitivo</h2>
              <p>Encontradas agora: <b>${Number(repetitive?.c || 0)}</b> questão(ões) começando por “Em uma atividade do...” ou “Em uma aula da/do/de...”.</p>
            </div>
            <a class="btn danger-link" href="/banco/limpar-repetitivas">Revisar e excluir</a>
          </div>
        </div>

        <div class="card">
          <h2>Importar questões em lote</h2>
          <p>Envie um arquivo de banco de questões preparado para o sistema. Assim você pode adicionar dezenas ou centenas de questões de uma só vez.</p>

          <form method="post" action="/banco/importar" enctype="multipart/form-data">
            <label>
              Arquivo do banco (.json ou .txt)
              <input type="file" name="question_file" accept=".json,.txt,application/json,text/plain" required>
            </label>
            <button style="margin-top:12px">📥 Importar questões</button>
          </form>

          <p style="margin-top:10px"><small>O sistema valida cada questão antes de salvar e mostra quantas foram importadas.</small></p>
        </div>

        <div class="card">
          <h2>Adicionar questão</h2>

          <form method="post" class="grid" enctype="multipart/form-data">
            <label>
              Nível
              <select name="level">
                <option>Fundamental</option>
                <option>Médio</option>
              </select>
            </label>

            <label>
              Ano/Série
              <input name="grade" placeholder="8º ano" required>
            </label>

            <label>
              Trimestre
              <select name="trimester">
                <option value="0">Geral</option>
                <option value="1">1º trimestre</option>
                <option value="2">2º trimestre</option>
                <option value="3">3º trimestre</option>
              </select>
            </label>

            <label>
              Fonte / Referência
              <select name="source">
                ${sourceOptions}
              </select>
            </label>

            <label>
              Unidade temática
              <input name="unit_theme" placeholder="Esportes">
            </label>

            <label>
              Assunto
              <input name="topic" placeholder="Voleibol" required>
            </label>

            <label>
              Subassunto
              <input name="subtopic" placeholder="Fundamentos / regras">
            </label>

            <label>
              Dificuldade
              <select name="difficulty">
                <option>Fácil</option>
                <option selected>Média</option>
                <option>Difícil</option>
              </select>
            </label>

            <label class="span">
              Habilidade / Objetivo
              <input name="skill" placeholder="Habilidade curricular ou objetivo de aprendizagem">
            </label>

            <label class="span">
              Enunciado
              <textarea name="statement" required></textarea>
            </label>

            <label>
              Alternativa A
              <input name="option_a" required>
            </label>

            <label>
              Alternativa B
              <input name="option_b" required>
            </label>

            <label>
              Alternativa C
              <input name="option_c" required>
            </label>

            <label>
              Alternativa D
              <input name="option_d" required>
            </label>

            <div class="span bank-new-image-box">
              <div>
                <span class="eyebrow blue">IMAGEM OPCIONAL</span>
                <b>Adicionar uma imagem relacionada à questão</b>
                <small>Ex.: foto de um esporte, diagrama tático, gráfico, postura corporal ou situação para análise.</small>
              </div>

              <label class="bank-image-upload">
                <span>🖼️ Escolher imagem</span>
                <input id="newQuestionImage"
                       type="file"
                       name="question_image"
                       accept="image/jpeg,image/png,image/webp">
              </label>

              <div id="newQuestionImagePreview" class="bank-new-image-preview" style="display:none">
                <img id="newQuestionImagePreviewImg" alt="Pré-visualização">
              </div>

              <label>
                Descrição da imagem
                <input name="image_alt"
                       placeholder="Ex.: atleta correndo com gráfico de frequência cardíaca">
              </label>

              <small>JPG, PNG ou WebP · máximo 1,5 MB.</small>
            </div>

            <label>
              Gabarito
              <select name="correct">
                <option>A</option>
                <option>B</option>
                <option>C</option>
                <option>D</option>
              </select>
            </label>

            <div>
              <button>Salvar questão</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2>Questões cadastradas</h2>
          <div class="table">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ano</th>
                  <th>Tri</th>
                  <th>Fonte</th>
                  <th>Assunto</th>
                  <th>Dificuldade</th>
                  <th>Questão</th>
                  <th>Imagem</th>
                  <th>Gab.</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </main>

      <script>
        const newImage = document.getElementById('newQuestionImage');
        const newPreview = document.getElementById('newQuestionImagePreview');
        const newPreviewImg = document.getElementById('newQuestionImagePreviewImg');

        if (newImage) {
          newImage.addEventListener('change', () => {
            const file = newImage.files && newImage.files[0];

            if (!file) {
              newPreview.style.display = 'none';
              return;
            }

            if (file.size > 1500000) {
              alert('A imagem deve ter no máximo 1,5 MB.');
              newImage.value = '';
              newPreview.style.display = 'none';
              return;
            }

            newPreviewImg.src = URL.createObjectURL(file);
            newPreview.style.display = 'block';
          });
        }
      </script>
    `
  );
}

async function addQuestion(request, env) {
  await ensureQuestionImageTable(env);

  const f = await request.formData();

  let image = null;

  try {
    image = await readQuestionImage(f.get('question_image'));
  } catch (e) {
    return page(
      'Imagem inválida',
      nav() + `
        <main>
          <div class="card">
            <h2>Não foi possível salvar a questão.</h2>
            <p>${esc(e.message || 'Imagem inválida.')}</p>
            <a class="btn" href="/banco">Voltar ao banco</a>
          </div>
        </main>
      `,
      400
    );
  }

  const inserted = await env.DB.prepare(`
    INSERT INTO questions
    (
      level,
      grade,
      topic,
      statement,
      option_a,
      option_b,
      option_c,
      option_d,
      correct,
      source,
      trimester,
      unit_theme,
      subtopic,
      difficulty,
      skill,
      active
    )
    VALUES
    (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1
    )
  `).bind(
    f.get('level'),
    f.get('grade'),
    f.get('topic'),
    f.get('statement'),
    f.get('option_a'),
    f.get('option_b'),
    f.get('option_c'),
    f.get('option_d'),
    f.get('correct'),
    f.get('source') || 'Questões autorais',
    Number(f.get('trimester') || 0),
    f.get('unit_theme') || '',
    f.get('subtopic') || '',
    f.get('difficulty') || 'Média',
    f.get('skill') || ''
  ).run();

  const questionId = Number(inserted.meta.last_row_id);

  if (image) {
    await upsertQuestionImage(
      env,
      questionId,
      image,
      f.get('image_alt') || ''
    );
  }

  return redirect('/banco');
}


async function importQuestions(request, env) {
  const f = await request.formData();
  const file = f.get('question_file');

  if (!file || typeof file.text !== 'function') {
    return page(
      'Importação',
      '<div class="login"><h2>Selecione um arquivo válido.</h2><a class="btn" href="/banco">Voltar</a></div>',
      400
    );
  }

  const raw = await file.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch (e) {
    return page(
      'Importação',
      '<div class="login"><h2>Arquivo inválido.</h2><p>O arquivo precisa estar no formato preparado para o EducaFísica Avalia.</p><a class="btn" href="/banco">Voltar</a></div>',
      400
    );
  }

  if (!Array.isArray(data)) {
    return page(
      'Importação',
      '<div class="login"><h2>Formato inválido.</h2><p>O arquivo deve conter uma lista de questões.</p><a class="btn" href="/banco">Voltar</a></div>',
      400
    );
  }

  const validCorrect = new Set(['A','B','C','D']);
  const validDifficulty = new Set(['Fácil','Média','Difícil']);
  const prepared = [];
  const errors = [];

  for (let i = 0; i < data.length; i++) {
    const q = data[i] || {};
    const row = i + 1;

    const required = [
      ['level', q.level],
      ['grade', q.grade],
      ['topic', q.topic],
      ['statement', q.statement],
      ['option_a', q.option_a],
      ['option_b', q.option_b],
      ['option_c', q.option_c],
      ['option_d', q.option_d],
      ['correct', q.correct]
    ];

    const missing = required.filter(([_, v]) => !String(v ?? '').trim()).map(([k]) => k);

    if (missing.length) {
      errors.push(`Questão ${row}: campos ausentes (${missing.join(', ')})`);
      continue;
    }

    const correct = String(q.correct).trim().toUpperCase();
    if (!validCorrect.has(correct)) {
      errors.push(`Questão ${row}: gabarito precisa ser A, B, C ou D`);
      continue;
    }

    let difficulty = String(q.difficulty || 'Média').trim();
    if (!validDifficulty.has(difficulty)) difficulty = 'Média';

    let trimester = Number(q.trimester ?? 0);
    if (![0,1,2,3].includes(trimester)) trimester = 0;

    prepared.push({
      level: String(q.level).trim(),
      grade: String(q.grade).trim(),
      topic: String(q.topic).trim(),
      statement: String(q.statement).trim(),
      option_a: String(q.option_a).trim(),
      option_b: String(q.option_b).trim(),
      option_c: String(q.option_c).trim(),
      option_d: String(q.option_d).trim(),
      correct,
      source: String(q.source || 'Questões autorais').trim(),
      trimester,
      unit_theme: String(q.unit_theme || '').trim(),
      subtopic: String(q.subtopic || '').trim(),
      difficulty,
      skill: String(q.skill || '').trim()
    });
  }

  if (!prepared.length) {
    const detail = errors.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('');
    return page(
      'Importação',
      `<div class="login"><h2>Nenhuma questão foi importada.</h2><ul style="text-align:left">${detail}</ul><a class="btn" href="/banco">Voltar</a></div>`,
      400
    );
  }

  const statements = prepared.map(q =>
    env.DB.prepare(`
      INSERT INTO questions
      (
        level, grade, topic, statement,
        option_a, option_b, option_c, option_d,
        correct, source, trimester, unit_theme,
        subtopic, difficulty, skill, active
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
    `).bind(
      q.level,
      q.grade,
      q.topic,
      q.statement,
      q.option_a,
      q.option_b,
      q.option_c,
      q.option_d,
      q.correct,
      q.source,
      q.trimester,
      q.unit_theme,
      q.subtopic,
      q.difficulty,
      q.skill
    )
  );

  // D1 batch limits can vary; import in smaller chunks.
  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    await env.DB.batch(statements.slice(i, i + chunkSize));
  }

  const warning = errors.length
    ? `<p><b>${errors.length}</b> registro(s) ignorado(s) por erro.</p>`
    : '';

  return page(
    'Importação concluída',
    `
      <div class="login">
        <h1>✅ Banco atualizado</h1>
        <p><b>${prepared.length}</b> questão(ões) importada(s) com sucesso.</p>
        ${warning}
        <a class="btn" href="/banco">Ver Banco de Questões</a>
        <a class="btn secondary" href="/provas/nova">Criar prova</a>
      </div>
    `
  );
}

async function newExam(env) {
  await ensureQuestionImageTable(env);

  const schools = await env.DB.prepare(`
    SELECT id,name
    FROM schools
    WHERE active=1
    ORDER BY name
  `).all();

  const sources = await env.DB.prepare(`
    SELECT DISTINCT source AS name
    FROM questions
    WHERE active=1
      AND source IS NOT NULL
      AND TRIM(source)<>''
    ORDER BY source
  `).all();

  const topicCounts = await env.DB.prepare(`
    SELECT
      grade,
      topic,
      COALESCE(trimester,0) AS trimester,
      COUNT(*) AS c
    FROM questions
    WHERE active=1
      AND topic IS NOT NULL
      AND TRIM(topic)<>''
    GROUP BY grade,topic,COALESCE(trimester,0)
    ORDER BY topic,grade,trimester
  `).all();

  const topicAvailability = {};

  for (const row of topicCounts.results) {
    const topic = String(row.topic || '').trim();
    const grade = String(row.grade || '').trim();
    const tri = String(Number(row.trimester || 0));

    if (!topicAvailability[topic]) topicAvailability[topic] = {};
    if (!topicAvailability[topic][grade]) {
      topicAvailability[topic][grade] = { '0':0, '1':0, '2':0, '3':0 };
    }

    topicAvailability[topic][grade][tri] =
      Number(topicAvailability[topic][grade][tri] || 0) + Number(row.c || 0);
  }

  const availabilityJson = JSON.stringify(topicAvailability)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');

  const allTopics = Object.keys(topicAvailability)
    .sort((a,b) => a.localeCompare(b, 'pt-BR'));

  const schoolOptions = schools.results.map(s =>
    `<option value="${s.id}">${esc(s.name)}</option>`
  ).join('');

  const preferredSource = sources.results.some(s =>
    s.name === 'Banco Mestre 2026 · Autoral analítico'
  )
    ? 'Banco Mestre 2026 · Autoral analítico'
    : sources.results.some(s => s.name === 'Banco Humanizado 2026 · CREP/RCO+')
      ? 'Banco Humanizado 2026 · CREP/RCO+'
      : '';

  const sourceOptions = sources.results.map(s => {
    const selected = s.name === preferredSource ? ' selected' : '';
    return `<option value="${attr(s.name)}"${selected}>${esc(s.name)}${selected ? ' · recomendado' : ''}</option>`;
  }).join('');

  const topicCards = allTopics.map(topic => `
    <label class="topic-multi-card" data-topic="${attr(topic)}">
      <input type="checkbox" name="topic_filters" value="${attr(topic)}">
      <span class="topic-check">✓</span>
      <span class="topic-multi-copy">
        <b>${esc(topic)}</b>
        <small data-topic-count>Escolha a série</small>
      </span>
    </label>
  `).join('');

  return page(
    'Criar prova',
    nav() + `
      <main class="create-exam-v18">
        <div class="hero create-hero-v18">
          <div>
            <span class="eyebrow white">NOVA AVALIAÇÃO</span>
            <h1>Criar prova</h1>
            <p>Escolha uma escola, turma e um ou vários assuntos. O sistema monta versões individuais para os alunos.</p>
          </div>
          <a class="btn light" href="/">← Painel</a>
        </div>

        <form method="post" id="examCreateForm">
          <div class="card grid">
            <label class="span">
              Título
              <input name="title" placeholder="Ex.: Avaliação de Educação Física" required>
            </label>

            <label class="span">
              Escola
              <select name="school_id" id="school" required>
                <option value="">Selecione a escola</option>
                ${schoolOptions}
              </select>
            </label>

            <label>
              Turno
              <select name="shift" id="shift" required>
                <option value="">Selecione</option>
                <option>Manhã</option>
                <option>Tarde</option>
                <option>Noturno</option>
                <option>Integral</option>
              </select>
            </label>

            <label>
              Etapa
              <select name="education_level" id="educationLevel" required>
                <option value="Fundamental">Ensino Fundamental</option>
                <option value="Médio">Ensino Médio</option>
              </select>
            </label>

            <label>
              Ano/Série
              <select name="grade" id="grade" required></select>
            </label>

            <div class="span batch-class-section">
              <div class="batch-class-head">
                <div>
                  <span class="eyebrow blue">TURMAS DA MESMA SÉRIE</span>
                  <b>Selecione uma ou várias turmas</b>
                  <small>Ex.: marque A, B e C e o sistema criará três provas de uma única vez.</small>
                </div>
                <div class="batch-class-tools">
                  <button type="button" class="btn small secondary" id="selectCommonClasses">A–D</button>
                  <button type="button" class="btn small secondary" id="selectAllClasses">Todas</button>
                  <button type="button" class="btn small secondary" id="clearClasses">Limpar</button>
                </div>
              </div>

              <div class="batch-class-grid" id="batchClassGrid">
                ${['A','B','C','D','E','F','G','H','T'].map(letter => `
                  <label class="batch-class-card">
                    <input type="checkbox" name="class_letters" value="${letter}">
                    <span class="batch-class-check">✓</span>
                    <b data-class-letter="${letter}">${letter}</b>
                  </label>
                `).join('')}
              </div>

              <div class="batch-class-status" id="batchClassStatus">
                Selecione pelo menos uma turma.
              </div>

              <label class="batch-custom-class">
                Outra turma (opcional)
                <input name="custom_class" id="customClass"
                       placeholder="Ex.: 1T, 2ADM, EJA A">
                <small>Você pode adicionar uma turma personalizada junto com A, B, C...</small>
              </label>
            </div>

            <label>
              Modalidade
              <select name="modality" id="modality">
                <option value="Regular">Regular</option>
                <option value="Técnico">Técnico</option>
              </select>
            </label>

            <label>
              Trimestre
              <select name="trimester" id="trimester" required>
                <option value="1">1º trimestre</option>
                <option value="2">2º trimestre</option>
                <option value="3">3º trimestre</option>
              </select>
            </label>

            <label>
              Valor da prova
              <input name="total_points" type="number" step="0.1" value="100" required>
            </label>
          </div>

          <div class="card">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow blue">ASSUNTOS / TEMAS</span>
                <h2>Selecione de 2 a 10 assuntos</h2>
                <p>Escolha no mínimo 2 e no máximo 10 assuntos. O número ao lado mostra quantas questões existem para a série escolhida.</p>
              </div>

              <div class="topic-multi-tools">
                <button type="button" class="btn small secondary" id="selectAllTopics">Selecionar disponíveis</button>
                <button type="button" class="btn small secondary" id="clearTopics">Limpar</button>
              </div>
            </div>

            <div class="topic-multi-status" id="topicMultiStatus">
              Selecione pelo menos 2 assuntos para criar a prova.
            </div>

            <div class="topic-multi-grid" id="topicMultiGrid">
              ${topicCards}
            </div>
          </div>

          <div class="card">
            <h2>Como você quer montar?</h2>

            <div class="mode-grid">
              <label class="mode-card">
                <input type="radio" name="generation_mode" value="auto" checked>
                <span>
                  <b>🎲 Gerar automaticamente</b><br>
                  <small>Sorteia questões dos assuntos selecionados e cria versões diferentes por aluno.</small>
                </span>
              </label>

              <label class="mode-card">
                <input type="radio" name="generation_mode" value="manual">
                <span>
                  <b>☑️ Selecionar manualmente</b><br>
                  <small>Carrega apenas as questões compatíveis com a série, trimestre e assuntos escolhidos.</small>
                </span>
              </label>
            </div>
          </div>

          <div class="card" id="autoBox">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow blue">GERADOR AUTOMÁTICO</span>
                <h2>Quantidade e dificuldade</h2>
              </div>
            </div>

            <div class="grid">
              <label>
                Fonte / Referência
                <select name="source_filter">
                  <option value="">Todas as fontes</option>
                  ${sourceOptions}
                </select>
              </label>

              <label>
                Dificuldade
                <select name="difficulty_filter">
                  <option value="">Mista</option>
                  <option>Fácil</option>
                  <option>Média</option>
                  <option>Difícil</option>
                </select>
              </label>

              <label>
                Número de questões por aluno
                <input id="questionCount"
                       name="question_count"
                       type="number"
                       min="1"
                       max="100"
                       value="10"
                       inputmode="numeric">
                <small>De 1 a 100 questões, conforme o banco disponível.</small>
              </label>
            </div>

            <div class="count-picker" aria-label="Atalhos de quantidade">
              <span>Quantidade rápida:</span>
              ${[5,10,15,20,25,30,40,50,60,80,100].map(n =>
                `<button type="button"
                         class="count-chip${n===10?' active':''}"
                         data-count="${n}">${n}</button>`
              ).join('')}
            </div>

            <div class="info-box v18-info-box">
              <b>Como será a prova:</b> se você marcar várias turmas, o sistema cria
              <b>um link diferente para cada turma</b> de uma única vez. O banco de questões
              é sorteado novamente para cada turma. Dentro de cada turma, cada aluno também
              recebe uma versão individual com questões e alternativas embaralhadas.
            </div>

            
          <div class="card v32-choice-card">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow blue">OPÇÕES DE CRIAÇÃO</span>
                <h2>Professor escolhe o que deseja criar</h2>
                <p>
                  Agora as recuperações não são mais geradas automaticamente.
                  Você decide se quer criar somente avaliações agora
                  ou se também deseja criar as recuperações vinculadas.
                </p>
              </div>
            </div>

            <div class="v32-choice-grid">
              <label class="v32-choice-box primary">
                <input type="checkbox" checked disabled>
                <div class="v32-choice-ill">📝</div>
                <div>
                  <b>Criar avaliações</b>
                  <small>
                    As avaliações principais serão criadas normalmente
                    para as turmas escolhidas.
                  </small>
                </div>
              </label>

              <label class="v32-choice-box">
                <input type="checkbox" name="create_recovery" value="1">
                <div class="v32-choice-ill">↻</div>
                <div>
                  <b>Também criar recuperações</b>
                  <small>
                    Marque esta opção somente quando quiser gerar
                    uma recuperação vinculada para cada avaliação criada.
                  </small>
                </div>
              </label>

              <label class="v32-choice-box">
                <input type="checkbox" name="keep_recovery_closed" value="1" checked>
                <div class="v32-choice-ill">🔒</div>
                <div>
                  <b>Manter recuperações fechadas</b>
                  <small>
                    Se você criar recuperações, elas já nascem encerradas
                    e o professor decide depois quando abrir.
                  </small>
                </div>
              </label>
            </div>

            <div class="filter-note">
              ✅ Padrão novo do sistema: criar apenas as avaliações.
              <br>
              ☑ Se quiser, marque a caixa de recuperação.
            </div>

            <button style="margin-top:15px">🎲 Gerar prova</button>
          </div>

          </div>

          <div class="card" id="manualBox" style="display:none">
            <div class="section-heading compact-heading">
              <div>
                <span class="eyebrow blue">SELEÇÃO MANUAL</span>
                <h2>Escolha as questões</h2>
                <p>Para manter a página rápida, as questões são carregadas somente quando você abre este modo.</p>
              </div>

              <button type="button" class="btn small secondary" id="reloadManual">
                ↻ Atualizar lista
              </button>
            </div>

            <div class="filter-note" id="manualStatus">Carregando...</div>
            <div class="question-list manual-ajax-list" id="manualQuestionList"></div>
            <button style="margin-top:15px">Criar com questões selecionadas</button>
          </div>
        </form>
      </main>

      <script>
        const topicAvailability = ${availabilityJson};

        const educationLevel = document.getElementById('educationLevel');
        const grade = document.getElementById('grade');
        const classInputs = [...document.querySelectorAll('input[name="class_letters"]')];
        const customClass = document.getElementById('customClass');
        const batchClassStatus = document.getElementById('batchClassStatus');
        const selectCommonClasses = document.getElementById('selectCommonClasses');
        const selectAllClasses = document.getElementById('selectAllClasses');
        const clearClasses = document.getElementById('clearClasses');
        const trimester = document.getElementById('trimester');
        const questionCount = document.getElementById('questionCount');
        const countChips = document.querySelectorAll('.count-chip');
        const topicCards = [...document.querySelectorAll('.topic-multi-card')];
        const selectAllTopics = document.getElementById('selectAllTopics');
        const clearTopics = document.getElementById('clearTopics');
        const topicMultiStatus = document.getElementById('topicMultiStatus');
        const manualQuestionList = document.getElementById('manualQuestionList');
        const manualStatus = document.getElementById('manualStatus');
        const reloadManual = document.getElementById('reloadManual');

        const gradesByLevel = {
          'Fundamental': ['6º ano','7º ano','8º ano','9º ano'],
          'Médio': ['1ª série','2ª série','3ª série']
        };

        function currentTopicCount(topic) {
          const selectedGrade = grade.value;
          const tri = String(Number(trimester.value || 0));
          const data = topicAvailability[topic]?.[selectedGrade];

          if (!data) return 0;

          return Number(data['0'] || 0) + Number(data[tri] || 0);
        }

        function selectedTopics() {
          return topicCards
            .filter(card => card.style.display !== 'none')
            .map(card => card.querySelector('input'))
            .filter(input => input.checked)
            .map(input => input.value);
        }

        function updateTopicCards() {
          let available = 0;

          topicCards.forEach(card => {
            const topic = card.dataset.topic;
            const count = currentTopicCount(topic);
            const countEl = card.querySelector('[data-topic-count]');
            const input = card.querySelector('input');

            card.style.display = count > 0 ? 'flex' : 'none';

            if (countEl) {
              countEl.textContent = count > 0
                ? count + ' questão(ões) disponíveis'
                : 'Sem questões nesta série';
            }

            if (count <= 0) input.checked = false;
            if (count > 0) available += 1;
          });

          updateTopicStatus(available);
        }

        function updateTopicStatus(availableCount = null) {
          const selected = selectedTopics();
          const visible = availableCount == null
            ? topicCards.filter(card => card.style.display !== 'none').length
            : availableCount;

          const total = selected.reduce(
            (sum, topic) => sum + currentTopicCount(topic),
            0
          );

          topicCards.forEach(card => {
            const input = card.querySelector('input');
            const locked = selected.length >= 10 && !input.checked;
            input.disabled = locked;
            card.classList.toggle('topic-limit-disabled', locked);
          });

          if (selected.length < 2) {
            topicMultiStatus.className =
              'topic-multi-status topic-status-warning';
            topicMultiStatus.innerHTML =
              '<b>Escolha pelo menos 2 assuntos.</b> ' +
              selected.length + ' selecionado(s) · ' +
              visible + ' disponível(is) para esta série.';
          } else if (selected.length === 10) {
            topicMultiStatus.className =
              'topic-multi-status topic-status-ok';
            topicMultiStatus.innerHTML =
              '<b>10 assuntos selecionados — máximo atingido.</b> · ' +
              total + ' questão(ões) disponíveis.';
          } else {
            topicMultiStatus.className =
              'topic-multi-status topic-status-ok';
            topicMultiStatus.innerHTML =
              '<b>' + selected.length + ' assuntos selecionados</b> · ' +
              total + ' questão(ões) disponíveis · máximo 10.';
          }

          return selected.length >= 2 && selected.length <= 10;
        }

        function fillGrades() {
          const values = gradesByLevel[educationLevel.value] || [];
          grade.innerHTML = values
            .map(v => '<option value="' + v + '">' + v + '</option>')
            .join('');

          updateTopicCards();
          if (currentMode() === 'manual') loadManualQuestions();
        }

        function gradePrefix() {
          const value = grade.value || '';
          if (value.startsWith('1ª')) return '1';
          if (value.startsWith('2ª')) return '2';
          if (value.startsWith('3ª')) return '3';
          if (value.startsWith('6º')) return '6';
          if (value.startsWith('7º')) return '7';
          if (value.startsWith('8º')) return '8';
          if (value.startsWith('9º')) return '9';
          return '';
        }

        function selectedClasses() {
          const regular = classInputs
            .filter(input => input.checked)
            .map(input => input.value);

          const custom = String(customClass.value || '').trim();

          return custom ? [...regular, custom] : regular;
        }

        function updateClassLabels() {
          const prefix = gradePrefix();

          document.querySelectorAll('[data-class-letter]').forEach(el => {
            const letter = el.dataset.classLetter;
            el.textContent = prefix ? prefix + letter : letter;
          });

          updateClassStatus();
        }

        function updateClassStatus() {
          const selected = selectedClasses();

          document.querySelectorAll('.batch-class-card').forEach(card => {
            const input = card.querySelector('input');
            card.classList.toggle('selected', input.checked);
          });

          if (!selected.length) {
            batchClassStatus.className = 'batch-class-status warning';
            batchClassStatus.innerHTML =
              '<b>Nenhuma turma selecionada.</b> Marque pelo menos uma.';
          } else if (selected.length === 1) {
            batchClassStatus.className = 'batch-class-status ok';
            batchClassStatus.innerHTML =
              '<b>1 turma selecionada.</b> Será criado 1 link.';
          } else {
            batchClassStatus.className = 'batch-class-status ok';
            batchClassStatus.innerHTML =
              '<b>' + selected.length + ' turmas selecionadas.</b> Serão criados ' +
              selected.length + ' links de uma única vez.';
          }

          return selected.length > 0 && selected.length <= 10;
        }

        countChips.forEach(chip => chip.addEventListener('click', () => {
          questionCount.value = chip.dataset.count;
          countChips.forEach(c => c.classList.toggle('active', c === chip));
        }));

        questionCount.addEventListener('input', () => {
          let n = Number(questionCount.value || 1);
          if (n > 100) questionCount.value = 100;
          if (n < 1) questionCount.value = 1;

          countChips.forEach(c =>
            c.classList.toggle(
              'active',
              Number(c.dataset.count) === Number(questionCount.value)
            )
          );
        });

        topicCards.forEach(card => {
          const input = card.querySelector('input');

          input.addEventListener('change', () => {
            const selected = selectedTopics();

            if (selected.length > 10) {
              input.checked = false;
              alert('Você pode selecionar no máximo 10 assuntos.');
            }

            updateTopicStatus();

            if (currentMode() === 'manual') {
              loadManualQuestions();
            }
          });
        });

        selectAllTopics.addEventListener('click', () => {
          let selectedCount = 0;

          topicCards.forEach(card => {
            const input = card.querySelector('input');

            if (card.style.display !== 'none' && selectedCount < 10) {
              input.checked = true;
              selectedCount += 1;
            } else {
              input.checked = false;
            }
          });

          updateTopicStatus();

          if (currentMode() === 'manual') {
            loadManualQuestions();
          }
        });

        clearTopics.addEventListener('click', () => {
          topicCards.forEach(card => {
            card.querySelector('input').checked = false;
          });
          updateTopicStatus();
          if (currentMode() === 'manual') loadManualQuestions();
        });

        educationLevel.addEventListener('change', fillGrades);

        grade.addEventListener('change', () => {
          updateTopicCards();
          updateClassLabels();
          if (currentMode() === 'manual') loadManualQuestions();
        });

        trimester.addEventListener('change', () => {
          updateTopicCards();
          if (currentMode() === 'manual') loadManualQuestions();
        });

        classInputs.forEach(input => {
          input.addEventListener('change', updateClassStatus);
        });

        customClass.addEventListener('input', updateClassStatus);

        selectCommonClasses.addEventListener('click', () => {
          classInputs.forEach(input => {
            input.checked = ['A','B','C','D'].includes(input.value);
          });
          updateClassStatus();
        });

        selectAllClasses.addEventListener('click', () => {
          classInputs.forEach(input => input.checked = true);
          updateClassStatus();
        });

        clearClasses.addEventListener('click', () => {
          classInputs.forEach(input => input.checked = false);
          customClass.value = '';
          updateClassStatus();
        });

        const autoBox = document.getElementById('autoBox');
        const manualBox = document.getElementById('manualBox');
        const modes = document.querySelectorAll('input[name="generation_mode"]');

        function currentMode() {
          return document.querySelector('input[name="generation_mode"]:checked')?.value || 'auto';
        }

        function updateMode() {
          const mode = currentMode();
          autoBox.style.display = mode === 'auto' ? 'block' : 'none';
          manualBox.style.display = mode === 'manual' ? 'block' : 'none';

          if (mode === 'manual') loadManualQuestions();
        }

        async function loadManualQuestions() {
          manualStatus.textContent = 'Carregando questões...';
          manualQuestionList.innerHTML =
            '<div class="manual-loading">⏳ Buscando questões compatíveis...</div>';

          const params = new URLSearchParams({
            grade: grade.value,
            trimester: trimester.value
          });

          const topics = selectedTopics();
          topics.forEach(topic => params.append('topic', topic));

          try {
            const response = await fetch('/api/questoes?' + params.toString(), {
              credentials: 'same-origin'
            });

            const data = await response.json();

            if (!response.ok) {
              throw new Error(data.error || 'Falha ao carregar questões.');
            }

            manualStatus.textContent =
              data.total + ' questão(ões) compatíveis. ' +
              (data.limited ? 'Mostrando as primeiras ' + data.items.length + '.' : '');

            if (!data.items.length) {
              manualQuestionList.innerHTML =
                '<div class="manual-loading">Nenhuma questão encontrada para estes filtros.</div>';
              return;
            }

            manualQuestionList.innerHTML = data.items.map(q => {
              const image = q.has_image
                ? '<img class="manual-question-thumb" src="/imagem/q/' + q.id + '?v=' + (q.image_updated_at || 0) + '" alt="">'
                : '';

              return (
                '<label class="pick manual-question">' +
                  '<input type="checkbox" name="question_ids" value="' + q.id + '">' +
                  image +
                  '<span>' +
                    '<b>' + escapeHtml(q.grade) + ' · ' + escapeHtml(q.topic) + '</b>' +
                    (q.has_image ? '<small class="manual-image-badge">🖼️ visual</small>' : '') +
                    '<br><small>' +
                      escapeHtml(q.source || 'Autoral') + ' · ' +
                      (q.trimester ? q.trimester + 'º tri' : 'Geral') + ' · ' +
                      escapeHtml(q.difficulty || 'Média') +
                    '</small><br>' +
                    escapeHtml(q.statement) +
                  '</span>' +
                '</label>'
              );
            }).join('');
          } catch (e) {
            manualStatus.textContent = 'Não foi possível carregar.';
            manualQuestionList.innerHTML =
              '<div class="manual-loading">' + escapeHtml(e.message || String(e)) + '</div>';
          }
        }

        function escapeHtml(value) {
          return String(value ?? '')
            .replaceAll('&','&amp;')
            .replaceAll('<','&lt;')
            .replaceAll('>','&gt;')
            .replaceAll('"','&quot;')
            .replaceAll("'",'&#039;');
        }

        reloadManual.addEventListener('click', loadManualQuestions);
        modes.forEach(m => m.addEventListener('change', updateMode));

        document.getElementById('examCreateForm').addEventListener(
          'submit',
          event => {
            const selected = selectedTopics();
            const classes = selectedClasses();

            if (!classes.length) {
              event.preventDefault();
              alert('Selecione pelo menos uma turma.');
              document.getElementById('batchClassGrid').scrollIntoView({
                behavior: 'smooth',
                block: 'center'
              });
              return;
            }

            if (classes.length > 10) {
              event.preventDefault();
              alert('Você pode criar no máximo 10 turmas por vez.');
              return;
            }

            if (selected.length < 2) {
              event.preventDefault();
              alert('Selecione pelo menos 2 assuntos para criar a prova.');
              document.getElementById('topicMultiGrid').scrollIntoView({
                behavior: 'smooth',
                block: 'center'
              });
              return;
            }

            if (selected.length > 10) {
              event.preventDefault();
              alert('Você pode selecionar no máximo 10 assuntos.');
              return;
            }

            if (classes.length > 1 && currentMode() === 'manual') {
              event.preventDefault();
              alert(
                'Para criar várias turmas com bancos de questões diferentes, use “Gerar automaticamente”.'
              );
            }
          }
        );

        fillGrades();
        updateClassLabels();
        updateMode();
      </script>
    `
  );
}

async function manualQuestionsApi(url, env) {
  await ensureQuestionImageTable(env);

  const grade = String(url.searchParams.get('grade') || '').trim();
  const trimester = Number(url.searchParams.get('trimester') || 0);
  const topics = url.searchParams
    .getAll('topic')
    .map(x => String(x || '').trim())
    .filter(Boolean);

  if (!grade) {
    return jsonResponse({ error: 'Série não informada.' }, 400);
  }

  const clauses = [
    'q.active=1',
    'q.grade=?',
    '(q.trimester=0 OR q.trimester=?)'
  ];

  const binds = [grade, trimester];

  if (topics.length) {
    clauses.push(`q.topic IN (${topics.map(() => '?').join(',')})`);
    binds.push(...topics);
  }

  const countRow = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM questions q
    WHERE ${clauses.join(' AND ')}
  `).bind(...binds).first();

  const total = Number(countRow?.c || 0);
  const maxItems = 250;

  const rows = await env.DB.prepare(`
    SELECT
      q.id,
      q.grade,
      q.trimester,
      q.source,
      q.topic,
      q.difficulty,
      q.statement,
      CASE WHEN qi.question_id IS NULL THEN 0 ELSE 1 END AS has_image,
      qi.updated_at AS image_updated_at
    FROM questions q
    LEFT JOIN question_images qi ON qi.question_id=q.id
    WHERE ${clauses.join(' AND ')}
    ORDER BY q.topic, q.difficulty, q.id DESC
    LIMIT ?
  `).bind(...binds, maxItems).all();

  return jsonResponse({
    total,
    limited: total > maxItems,
    items: rows.results
  });
}

async function createExam(request, env) {
  const f = await request.formData();

  const schoolId = Number(f.get('school_id'));
  const shift = String(f.get('shift') || '').trim();
  const educationLevel = String(f.get('education_level') || '').trim();
  const grade = String(f.get('grade') || '').trim();
  const modality = String(f.get('modality') || 'Regular').trim();
  const customClass = String(f.get('custom_class') || '').trim();

  const classLetters = [...new Set(
    f.getAll('class_letters')
      .map(x => String(x || '').trim().toUpperCase())
      .filter(x => ['A','B','C','D','E','F','G','H','T'].includes(x))
  )];

  const school = await env.DB.prepare(`
    SELECT id,name
    FROM schools
    WHERE id=? AND active=1
  `).bind(schoolId).first();

  if (!school || !shift || !grade) {
    return page(
      'Atenção',
      '<div class="login"><h2>Preencha escola, turno e série.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
      400
    );
  }

  const allowedGrades = educationLevel === 'Médio'
    ? ['1ª série','2ª série','3ª série']
    : ['6º ano','7º ano','8º ano','9º ano'];

  if (!allowedGrades.includes(grade)) {
    return page(
      'Atenção',
      '<div class="login"><h2>Ano/Série inválido.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
      400
    );
  }

  const prefix = grade.startsWith('1ª') ? '1'
    : grade.startsWith('2ª') ? '2'
    : grade.startsWith('3ª') ? '3'
    : grade.startsWith('6º') ? '6'
    : grade.startsWith('7º') ? '7'
    : grade.startsWith('8º') ? '8'
    : grade.startsWith('9º') ? '9'
    : '';

  const rawClassNames = classLetters.map(letter => `${prefix}${letter}`);

  if (customClass) {
    rawClassNames.push(customClass);
  }

  const uniqueRawClasses = [...new Set(
    rawClassNames.map(x => String(x || '').trim()).filter(Boolean)
  )];

  if (!uniqueRawClasses.length) {
    return page(
      'Atenção',
      '<div class="login"><h2>Selecione pelo menos uma turma.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
      400
    );
  }

  if (uniqueRawClasses.length > 10) {
    return page(
      'Atenção',
      '<div class="login"><h2>Você pode criar no máximo 10 turmas por vez.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
      400
    );
  }

  const classNames = uniqueRawClasses.map(base =>
    modality === 'Técnico' ? `${base} (Técnico)` : base
  );

  const mode = String(f.get('generation_mode') || 'auto');
  const trimester = Number(f.get('trimester') || 1);
  const createRecovery = ['1','on','true'].includes(
    String(f.get('create_recovery') || '').toLowerCase()
  );
  const keepRecoveryClosed = !['0','false'].includes(
    String(f.get('keep_recovery_closed') || '1').toLowerCase()
  );

  const selectedTopics = f.getAll('topic_filters')
    .map(x => String(x || '').trim())
    .filter(Boolean);

  if (selectedTopics.length < 2 || selectedTopics.length > 10) {
    return page(
      'Seleção de assuntos',
      `
        <div class="login">
          <h2>Escolha de 2 a 10 assuntos.</h2>
          <p>Você selecionou <b>${selectedTopics.length}</b> assunto(s).</p>
          <a class="btn" href="/provas/nova">Voltar e escolher</a>
        </div>
      `,
      400
    );
  }

  if (classNames.length > 1 && mode === 'manual') {
    return page(
      'Criação em lote',
      `
        <div class="login">
          <h2>Para várias turmas, use o gerador automático.</h2>
          <p>Assim o sistema consegue criar um banco de questões diferente para cada turma.</p>
          <a class="btn" href="/provas/nova">Voltar</a>
        </div>
      `,
      400
    );
  }

  const totalPoints = Number(f.get('total_points') || 100);
  const baseTitle = String(f.get('title') || 'Avaliação de Educação Física').trim();
  const createdExamIds = [];
  const usedPoolSignatures = new Set();

  let studentQuestionCount = 0;
  let manualIds = [];

  // Critérios do automático ficam prontos uma vez, mas o sorteio é repetido por turma.
  const source = String(f.get('source_filter') || '').trim();
  const difficulty = String(f.get('difficulty_filter') || '').trim();
  const automaticCount = Math.max(
    1,
    Math.min(100, Number(f.get('question_count') || 10))
  );

  const autoClauses = [
    'active=1',
    'grade=?',
    '(trimester=0 OR trimester=?)'
  ];

  const autoBinds = [grade, trimester];

  if (source) {
    autoClauses.push('source=?');
    autoBinds.push(source);
  }

  if (selectedTopics.length) {
    autoClauses.push(
      `topic IN (${selectedTopics.map(() => '?').join(',')})`
    );
    autoBinds.push(...selectedTopics);
  }

  if (difficulty) {
    autoClauses.push('difficulty=?');
    autoBinds.push(difficulty);
  }

  let candidateTotal = 0;
  let perClassPoolLimit = 0;

  if (mode === 'manual') {
    manualIds = f.getAll('question_ids').map(Number).filter(Boolean);
    studentQuestionCount = manualIds.length;

    if (!manualIds.length) {
      return page(
        'Atenção',
        '<div class="login"><h2>Selecione pelo menos uma questão.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
        400
      );
    }

    const placeholders = manualIds.map(() => '?').join(',');
    const topicPlaceholders = selectedTopics.map(() => '?').join(',');

    const validManual = await env.DB.prepare(`
      SELECT COUNT(*) AS c
      FROM questions
      WHERE id IN (${placeholders})
        AND topic IN (${topicPlaceholders})
        AND grade=?
        AND (trimester=0 OR trimester=?)
        AND active=1
    `).bind(
      ...manualIds,
      ...selectedTopics,
      grade,
      trimester
    ).first();

    if (Number(validManual?.c || 0) !== manualIds.length) {
      return page(
        'Seleção inválida',
        '<div class="login"><h2>Alguma questão não corresponde aos filtros escolhidos.</h2><a class="btn" href="/provas/nova">Voltar</a></div>',
        400
      );
    }
  } else {
    studentQuestionCount = automaticCount;

    const totalRow = await env.DB.prepare(`
      SELECT COUNT(*) AS c
      FROM questions
      WHERE ${autoClauses.join(' AND ')}
    `).bind(...autoBinds).first();

    candidateTotal = Number(totalRow?.c || 0);

    if (candidateTotal < automaticCount) {
      return page(
        'Banco insuficiente',
        `
          <div class="login">
            <h2>Não há questões suficientes para esse filtro.</h2>
            <p>Encontradas: <b>${candidateTotal}</b> de <b>${automaticCount}</b>.</p>
            <p>Escolha mais assuntos, dificuldade mista ou importe mais questões.</p>
            <a class="btn" href="/provas/nova">Voltar</a>
          </div>
        `,
        400
      );
    }

    // Mantém um pool individual por turma.
    // Se houver bastante banco, cada turma usa apenas parte dele para os conjuntos ficarem diferentes.
    const desiredPool = Math.max(
      automaticCount,
      Math.min(220, Math.max(automaticCount * 3, selectedTopics.length * 35))
    );

    perClassPoolLimit = Math.min(
      candidateTotal,
      Math.max(
        automaticCount,
        candidateTotal > automaticCount
          ? Math.min(desiredPool, Math.max(automaticCount, Math.floor(candidateTotal * 0.72)))
          : automaticCount
      )
    );
  }

  for (let classIndex = 0; classIndex < classNames.length; classIndex++) {
    const className = classNames[classIndex];

    // Reutiliza a turma se ela já existir; caso contrário, cadastra automaticamente.
    let classInfo = await env.DB.prepare(`
      SELECT id,school_id,shift,class_name,grade
      FROM school_classes
      WHERE school_id=? AND shift=? AND class_name=? AND grade=? AND active=1
      ORDER BY id
      LIMIT 1
    `).bind(schoolId, shift, className, grade).first();

    if (!classInfo) {
      const inserted = await env.DB.prepare(`
        INSERT INTO school_classes
          (school_id, shift, class_name, grade, active)
        VALUES
          (?,?,?,?,1)
      `).bind(schoolId, shift, className, grade).run();

      classInfo = {
        id: inserted.meta.last_row_id,
        school_id: schoolId,
        shift,
        class_name: className,
        grade
      };
    }

    let ids = [];

    if (mode === 'manual') {
      ids = [...manualIds];
    } else {
      // Novo sorteio para CADA turma.
      // Se, por acaso, sair um conjunto idêntico ao de outra turma, tenta novamente.
      let attempts = 0;
      let signature = '';

      do {
        const picked = await env.DB.prepare(`
          SELECT id
          FROM questions
          WHERE ${autoClauses.join(' AND ')}
          ORDER BY RANDOM()
          LIMIT ?
        `).bind(...autoBinds, perClassPoolLimit).all();

        ids = picked.results.map(x => Number(x.id));
        signature = [...ids].sort((a,b) => a-b).join(',');
        attempts += 1;
      } while (
        classNames.length > 1 &&
        candidateTotal > automaticCount &&
        usedPoolSignatures.has(signature) &&
        attempts < 6
      );

      usedPoolSignatures.add(signature);
    }

    const token = await uniqueExamToken(env);
    const finalTitle = classNames.length > 1
      ? `${baseTitle} · ${className}`
      : baseTitle;

    const r = await env.DB.prepare(`
      INSERT INTO exams
        (token,title,level,grade,class_name,total_points,active)
      VALUES
        (?,?,?,?,?,?,1)
    `).bind(
      token,
      finalTitle,
      educationLevel === 'Médio' ? 'Médio' : 'Fundamental',
      grade,
      className,
      totalPoints
    ).run();

    const examId = Number(r.meta.last_row_id);

    await env.DB.batch(
      ids.map((id, i) =>
        env.DB
          .prepare(`
            INSERT INTO exam_questions
              (exam_id,question_id,position)
            VALUES
              (?,?,?)
          `)
          .bind(examId, id, i + 1)
      )
    );

    await env.DB.prepare(`
      INSERT OR REPLACE INTO exam_context
        (exam_id, school_id, school_class_id, trimester)
      VALUES
        (?,?,?,?)
    `).bind(
      examId,
      schoolId,
      classInfo.id,
      trimester
    ).run();

    await ensureExamVariantTables(env);

    await env.DB.prepare(`
      INSERT OR REPLACE INTO exam_variant_settings
        (exam_id, question_count, randomize_questions, randomize_options)
      VALUES
        (?,?,1,1)
    `).bind(
      examId,
      Math.max(
        1,
        Math.min(studentQuestionCount || ids.length, ids.length)
      )
    ).run();

    if (createRecovery) {
      const recoveryId = await createRecoveryExamFromOriginal(env, examId);

      if (!keepRecoveryClosed) {
        await env.DB.prepare(`
          UPDATE exams
          SET active=1
          WHERE id=?
        `).bind(recoveryId).run();
      }
    }

    createdExamIds.push(examId);
  }

  if (createdExamIds.length === 1) {
    return redirect(`/provas/${createdExamIds[0]}`);
  }

  return redirect(
    `/provas/lote?ids=${encodeURIComponent(createdExamIds.join(','))}`
  );
}

async function examBatchPage(url, env, requestUrl) {
  const ids = String(url.searchParams.get('ids') || '')
    .split(',')
    .map(Number)
    .filter(Number.isFinite)
    .filter(id => id > 0)
    .slice(0, 10);

  if (!ids.length) {
    return redirect('/');
  }

  const placeholders = ids.map(() => '?').join(',');

  const rows = await env.DB.prepare(`
    SELECT
      e.id,
      e.token,
      e.title,
      e.grade,
      e.class_name,
      e.active,
      sc.name AS school_name,
      cl.shift AS shift,
      ec.trimester AS trimester,
      COUNT(eq.question_id) AS pool_size,
      evs.question_count AS question_count
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools sc ON sc.id=ec.school_id
    LEFT JOIN school_classes cl ON cl.id=ec.school_class_id
    LEFT JOIN exam_questions eq ON eq.exam_id=e.id
    LEFT JOIN exam_variant_settings evs ON evs.exam_id=e.id
    WHERE e.id IN (${placeholders})
    GROUP BY e.id
    ORDER BY cl.class_name
  `).bind(...ids).all();

  if (!rows.results.length) {
    return redirect('/');
  }

  const origin = new URL(requestUrl).origin;

  const copyAllText = rows.results.map(e =>
    `${e.class_name}: ${origin}/e/${e.token}`
  ).join('\\n');

  const cards = rows.results.map((e, index) => {
    const link = `${origin}/e/${e.token}`;
    const qrUrl =
      `https://quickchart.io/qr?text=${encodeURIComponent(link)}` +
      `&size=220&margin=2&ecLevel=M&format=svg`;

    return `
      <article class="batch-created-card">
        <div class="batch-created-top">
          <span class="batch-created-number">${index + 1}</span>
          <div>
            <span class="eyebrow blue">TURMA</span>
            <h2>${esc(e.class_name)}</h2>
            <p>${esc(e.school_name || '')} · ${esc(e.shift || '')} · ${e.trimester || ''}º trimestre</p>
          </div>
          <span class="batch-created-ok">✓ CRIADA</span>
        </div>

        <div class="batch-created-info">
          <span><b>${Number(e.question_count || 0)}</b><small>questões por aluno</small></span>
          <span><b>${Number(e.pool_size || 0)}</b><small>questões no banco da turma</small></span>
        </div>

        <div class="batch-created-share">
          <div class="batch-created-link">
            <label>Link para esta turma</label>
            <div>
              <input id="batchLink${e.id}" value="${attr(link)}" readonly>
              <button type="button"
                onclick="copyBatchLink('batchLink${e.id}',this)">Copiar</button>
            </div>

            <div class="batch-created-actions">
              <a class="btn small secondary" href="/provas/${e.id}">Abrir prova</a>
              <a class="btn small secondary" href="/provas/${e.id}/resultados">Notas</a>
            </div>
          </div>

          <div class="batch-created-qr">
            <img src="${attr(qrUrl)}" width="170" height="170"
                 alt="QR Code da turma ${attr(e.class_name)}">
            <small>QR Code · ${esc(e.class_name)}</small>
          </div>
        </div>
      </article>`;
  }).join('');

  return page(
    'Provas criadas',
    nav() + `
      <main class="batch-result-page">
        <section class="batch-result-hero">
          <div>
            <span class="eyebrow white">CRIAÇÃO EM LOTE CONCLUÍDA</span>
            <h1>${rows.results.length} provas criadas de uma vez</h1>
            <p>Cada turma recebeu um link próprio e um banco de questões sorteado separadamente.</p>
          </div>
          <a class="btn light" href="/">Ir ao painel</a>
        </section>

        <section class="card batch-copy-all">
          <div>
            <span class="eyebrow blue">CLASSROOM / WHATSAPP</span>
            <h2>Copiar todos os links</h2>
            <p>Os links já ficam identificados pela turma.</p>
          </div>

          <textarea id="batchAllLinks" readonly>${esc(copyAllText)}</textarea>

          <button type="button" onclick="copyBatchAll(this)">
            📋 Copiar todas as turmas
          </button>
        </section>

        <div class="batch-difference-note">
          <span>🔀</span>
          <div>
            <b>As provas não são cópias umas das outras.</b>
            <p>O banco foi sorteado separadamente para cada turma. Se o professor marcou a opção de recuperação, ela também foi criada vinculada. Quando o aluno abre o link, o sistema ainda faz randomização individual.</p>
          </div>
        </div>

        <section class="batch-created-grid">
          ${cards}
        </section>

        <div class="batch-result-footer">
          <a class="btn" href="/provas/nova">＋ Criar outro lote</a>
          <a class="btn secondary" href="/">Voltar ao painel</a>
        </div>
      </main>

      <div id="batchToast" class="copy-toast">✓ Copiado</div>

      <script>
        async function copyBatchLink(id, button) {
          const input = document.getElementById(id);
          if (!input) return;

          try {
            await navigator.clipboard.writeText(input.value);
            const old = button.textContent;
            button.textContent = '✓ Copiado';
            showBatchToast();
            setTimeout(() => button.textContent = old, 1500);
          } catch (e) {
            input.select();
            document.execCommand('copy');
            showBatchToast();
          }
        }

        async function copyBatchAll(button) {
          const area = document.getElementById('batchAllLinks');
          if (!area) return;

          try {
            await navigator.clipboard.writeText(area.value);
            const old = button.innerHTML;
            button.innerHTML = '✓ Todos os links copiados';
            showBatchToast();
            setTimeout(() => button.innerHTML = old, 1700);
          } catch (e) {
            area.select();
            document.execCommand('copy');
            showBatchToast();
          }
        }

        function showBatchToast() {
          const toast = document.getElementById('batchToast');
          if (!toast) return;
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 1500);
        }
      </script>
    `
  );
}

async function examDetail(env, id, origin) {
  const e = await env.DB.prepare(`
    SELECT
      e.*,
      s.name AS school_name,
      c.shift AS shift,
      c.class_name AS linked_class_name,
      c.grade AS linked_grade,
      ec.trimester AS trimester
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools s ON s.id=ec.school_id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE e.id=?
  `).bind(id).first();

  if (!e) return page('Erro', '<p>Prova não encontrada.</p>', 404);

  await ensureExamVariantTables(env);
  await ensureQuestionImageTable(env);
  await ensureRecoveryTables(env);

  const recoveryRelation = await getRecoveryRelation(env, id);

  const linkedRecovery = recoveryRelation.role === 'original' && recoveryRelation.recovery_exam_id
    ? await env.DB.prepare(`
        SELECT e.id,e.title,e.token,e.active,
               COUNT(su.id) AS submissions
        FROM exams e
        LEFT JOIN submissions su ON su.exam_id=e.id
        WHERE e.id=?
        GROUP BY e.id
      `).bind(recoveryRelation.recovery_exam_id).first()
    : null;

  const linkedOriginal = recoveryRelation.role === 'recovery'
    ? await env.DB.prepare(`
        SELECT id,title,token,active
        FROM exams
        WHERE id=?
      `).bind(recoveryRelation.original_exam_id).first()
    : null;

  const variantSettings = await env.DB.prepare(`
    SELECT question_count, randomize_questions, randomize_options
    FROM exam_variant_settings
    WHERE exam_id=?
  `).bind(id).first();

  const qs = await env.DB.prepare(`
    SELECT
      q.*,
      eq.position,
      CASE WHEN qi.question_id IS NULL THEN 0 ELSE 1 END AS has_image,
      COALESCE(qi.alt_text,'') AS image_alt,
      qi.updated_at AS image_updated_at
    FROM exam_questions eq
    JOIN questions q ON q.id=eq.question_id
    LEFT JOIN question_images qi ON qi.question_id=q.id
    WHERE eq.exam_id=?
    ORDER BY eq.position
  `).bind(id).all();

  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM submissions WHERE exam_id=?'
  ).bind(id).first();

  const perStudentCount = Math.max(
    1,
    Math.min(
      Number(variantSettings?.question_count || qs.results.length),
      qs.results.length || 1
    )
  );

  const link = `${origin}/e/${e.token}`;
  const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(link)}&size=240&margin=2&ecLevel=M&format=svg`;
  const list = qs.results.map(q => `
    <li class="exam-question-list-item">
      ${q.has_image ? `
        <img src="/imagem/q/${q.id}?v=${q.image_updated_at || 0}"
             alt="${attr(q.image_alt || 'Imagem da questão')}">
      ` : ''}
      <span><b>${q.position}. ${esc(q.topic)}</b> — ${esc(q.statement)}</span>
    </li>
  `).join('');

  const context = [
    e.school_name,
    e.shift,
    e.linked_class_name || e.class_name,
    e.trimester ? `${e.trimester}º trimestre` : null
  ].filter(Boolean).map(esc).join(' · ');

  return page(
    e.title,
    nav() + `
      <main>
        <div class="hero">
          <div>
            <h1>${esc(e.title)}</h1>
            <p>${context || (esc(e.grade) + ' · ' + esc(e.class_name || ''))}</p>
          </div>
          <a class="btn secondary" href="/">← Painel</a>
        </div>

        <div class="cards">
          <div class="card stat"><b>${count.c}</b><span>Respostas</span></div>
          <div class="card stat"><b>${perStudentCount}</b><span>Questões por aluno</span></div>
          <div class="card stat"><b>${qs.results.length}</b><span>Banco da prova</span></div>
          <div class="card stat"><b>${e.active ? 'Aberta' : 'Encerrada'}</b><span>Status</span></div>
        </div>

        <div class="card share-exam-card">
          <div class="share-exam-copy">
            <span class="eyebrow blue">${recoveryRelation.role === 'recovery' ? 'RECUPERAÇÃO' : 'ACESSO DO ALUNO'}</span>
            <h2>${recoveryRelation.role === 'recovery' ? 'Link da recuperação' : 'Link curto da prova'}</h2>
            <div class="short-link-box">
              <input id="link" value="${attr(link)}" readonly>
              <button onclick="navigator.clipboard.writeText(document.getElementById('link').value);this.textContent='Copiado ✓';">Copiar link</button>
            </div>
            <p><small>Envie o mesmo link para toda a turma. Cada aluno recebe uma versão individual da prova.</small></p>
            <div class="variant-note">🔀 Questões e alternativas são embaralhadas individualmente. Quando o banco da prova tem mais questões que a quantidade escolhida, cada aluno também recebe uma seleção diferente.</div>
          </div>
          <div class="qr-box">
            <img src="${attr(qrUrl)}" width="210" height="210" alt="QR Code para abrir a prova">
            <b>QR Code da prova</b>
            <small>O aluno aponta a câmera e abre diretamente.</small>
          </div>
        </div>

        <div class="card actions">
          <a class="btn" href="/provas/${id}/resultados">Notas e gráficos</a>
          <a class="btn secondary" href="/provas/${id}/imprimir" target="_blank">🖨 PDF / Imprimir</a>
          <form method="post" action="/provas/${id}/toggle">
            <button class="secondary">${e.active ? 'Encerrar prova' : 'Reabrir prova'}</button>
          </form>
          <a class="btn secondary" href="/provas/${id}/resultados.csv">Baixar CSV</a>
          <form method="post" action="/provas/${id}/excluir"
                onsubmit="return confirm('Excluir esta prova e todos os resultados dos alunos? Esta ação não pode ser desfeita.');">
            <button class="delete-exam-button">🗑 Excluir prova</button>
          </form>
        </div>

        ${recoveryRelation.role === 'original' ? `
          <section class="recovery-link-card">
            <div class="recovery-link-icon">↻</div>
            <div class="recovery-link-copy">
              <span class="eyebrow blue">RECUPERAÇÃO DA AVALIAÇÃO</span>
              ${linkedRecovery ? `
                <h2>${esc(linkedRecovery.title)}</h2>
                <p>
                  A recuperação já está vinculada a esta prova.
                  A maior nota entre prova e recuperação é a que vale para a média final.
                </p>
                <div class="recovery-link-status">
                  <span class="${linkedRecovery.active ? 'recovery-open' : 'recovery-closed'}">
                    ${linkedRecovery.active ? '● Aberta' : '● Encerrada'}
                  </span>
                  <span>${Number(linkedRecovery.submissions || 0)} resposta(s)</span>
                </div>
              ` : `
                <h2>Recuperação ainda não criada</h2>
                <p>Crie uma recuperação usando os mesmos conteúdos desta avaliação.</p>
              `}
            </div>

            <div class="recovery-link-actions">
              ${linkedRecovery ? `
                <a class="btn" href="/provas/${linkedRecovery.id}">Abrir recuperação</a>
                <a class="btn secondary" target="_blank" href="/provas/${linkedRecovery.id}/imprimir">🖨 PDF</a>
              ` : `
                <form method="post" action="/provas/${id}/recuperacao/criar">
                  <button>＋ Criar recuperação</button>
                </form>
              `}
            </div>
          </section>
        ` : `
          <section class="recovery-link-card is-recovery">
            <div class="recovery-link-icon">★</div>
            <div class="recovery-link-copy">
              <span class="eyebrow blue">ESTA É UMA RECUPERAÇÃO</span>
              <h2>Nota substitutiva pela maior</h2>
              <p>
                Se o aluno fizer a avaliação original e esta recuperação,
                a menor nota é ignorada e a maior é usada na média.
              </p>
            </div>
            ${linkedOriginal ? `
              <div class="recovery-link-actions">
                <a class="btn secondary" href="/provas/${linkedOriginal.id}">Ver avaliação original</a>
              </div>
            ` : ''}
          </section>
        `}

        <div class="card">
          <h2>Banco de questões desta prova</h2>
          <p><small>Este é o conjunto usado para gerar as versões individuais. O aluno vê ${perStudentCount} questão(ões).</small></p>
          <ol>${list}</ol>
        </div>
      </main>
    `
  );
}


function printableExamHtml(e, qs, options = {}) {
  const studentName = String(options.studentName || '').trim();
  const answered = options.answers || {};
  const isStudentCopy = Boolean(options.studentCopy);

  const titleType = isStudentCopy
    ? 'Cópia da avaliação realizada'
    : (options.isRecovery ? 'Recuperação impressa' : 'Avaliação impressa');

  const school = esc(e.school_name || '');
  const className = esc(e.linked_class_name || e.class_name || '');
  const shift = esc(e.shift || '');
  const trimester = Number(e.trimester || 0);

  const questions = qs.map((q, index) => {
    const visual = questionVisualProfile(q, index + 1);

    const alternatives = ['A','B','C','D'].map(letter => {
      const selected = String(answered[String(q.id)] || '') === letter;

      return `
        <div class="paper-answer ${selected ? 'paper-selected' : ''}">
          <span>${selected ? '●' : '○'} ${letter}</span>
          <p>${esc(q['option_' + letter.toLowerCase()] || '')}</p>
        </div>`;
    }).join('');

    return `
      <section class="paper-question">
        <div class="paper-q-head">
          <span>${index + 1}</span>
          <b>${esc(visual.label)}</b>
        </div>

        ${q.has_image ? `
          <img class="paper-question-image"
               src="/imagem/q/${q.id}?v=${q.image_updated_at || 0}"
               alt="${attr(q.image_alt || 'Imagem da questão')}">
        ` : ''}

        <h3>${esc(q.statement)}</h3>
        <div class="paper-answers">${alternatives}</div>
      </section>`;
  }).join('');

  return `<!doctype html>
  <html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(e.title)} - PDF/Imprimir</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#14233b;background:#eef2f6;margin:0}
      .paper-toolbar{position:sticky;top:0;z-index:10;display:flex;justify-content:center;gap:8px;padding:10px;background:#10264a}
      .paper-toolbar button,.paper-toolbar a{border:0;border-radius:9px;padding:10px 14px;font-weight:800;text-decoration:none;cursor:pointer}
      .paper-toolbar button{background:#fff;color:#174f9c}.paper-toolbar a{background:#253d61;color:#fff}
      .paper{width:210mm;max-width:100%;min-height:297mm;margin:18px auto;background:white;padding:14mm;box-shadow:0 10px 30px rgba(15,35,60,.13)}
      .paper-head{border-bottom:3px solid #1c69d5;padding-bottom:9px;margin-bottom:10px}
      .paper-brand{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
      .paper-logo{width:48px;height:48px;border-radius:12px;background:#1767d6;color:white;display:grid;place-items:center;font-size:18px;font-weight:900}
      .paper-brand-copy{flex:1}.paper-brand-copy small{font-size:9px;font-weight:800;color:#5d7190}.paper-brand-copy h1{font-size:19px;margin:3px 0}.paper-brand-copy p{font-size:9px;margin:0;color:#67758a}
      .paper-type{background:#edf4ff;color:#1c61bd;border-radius:999px;padding:6px 9px;font-size:8px;font-weight:900}
      .paper-student{display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin:11px 0}
      .paper-field{border:1px solid #bfc9d7;border-radius:7px;padding:7px;min-height:38px}.paper-field small{display:block;font-size:7px;color:#68798d;font-weight:800}.paper-field b{font-size:10px}
      .paper-note{font-size:8px;padding:7px 9px;background:#fff7e7;border:1px solid #efd9aa;border-radius:7px;color:#69531f;margin-bottom:10px}
      .paper-question{break-inside:avoid;border:1px solid #dce3ec;border-radius:9px;padding:9px;margin:0 0 9px}
      .paper-q-head{display:flex;align-items:center;gap:7px;margin-bottom:6px}.paper-q-head>span{width:25px;height:25px;border-radius:7px;background:#1767d6;color:white;display:grid;place-items:center;font-size:9px;font-weight:900}.paper-q-head b{font-size:8px;color:#4170aa}
      .paper-question h3{font-size:10.5px;line-height:1.43;margin:5px 0 7px}
      .paper-question-image{display:block;width:100%;max-height:75mm;object-fit:contain;border:1px solid #dfe5ec;border-radius:7px;margin:5px 0 8px}
      .paper-answers{display:grid;gap:4px}.paper-answer{display:grid;grid-template-columns:38px 1fr;gap:4px;align-items:start;border:1px solid #e2e7ed;border-radius:6px;padding:5px}.paper-answer span{font-size:9px;font-weight:900;color:#405b79}.paper-answer p{font-size:9px;line-height:1.3;margin:0}.paper-selected{background:#edf8f2;border-color:#9bcfb7}
      .paper-footer{text-align:center;margin-top:11px;font-size:7px;color:#8591a1}
      @page{size:A4;margin:8mm}
      @media print{
        body{background:white}
        .paper-toolbar{display:none!important}
        .paper{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}
      }
      @media(max-width:700px){
        .paper{margin:0;padding:12px;min-height:100vh}
        .paper-student{grid-template-columns:1fr}
      }
    </style>
  </head>
  <body>
    <div class="paper-toolbar">
      <button onclick="window.print()">⬇ Salvar como PDF / Imprimir</button>
      <a href="javascript:history.back()">Voltar</a>
    </div>

    <main class="paper">
      <header class="paper-head">
        <div class="paper-brand">
          <span class="paper-logo">EF</span>
          <div class="paper-brand-copy">
            <small>EDUCAFÍSICA AVALIA</small>
            <h1>${esc(e.title)}</h1>
            <p>${school}${school && className ? ' · ' : ''}${className}${shift ? ' · ' + shift : ''}${trimester ? ' · ' + trimester + 'º trimestre' : ''}</p>
          </div>
          <span class="paper-type">${titleType}</span>
        </div>
      </header>

      <section class="paper-student">
        <div class="paper-field">
          <small>ALUNO(A)</small>
          <b>${studentName ? esc(studentName) : '_______________________________________________'}</b>
        </div>
        <div class="paper-field"><small>TURMA</small><b>${className || '__________'}</b></div>
        <div class="paper-field"><small>DATA</small><b>____ / ____ / ______</b></div>
      </section>

      <div class="paper-note">
        ${isStudentCopy
          ? 'Esta é uma cópia da versão individual realizada pelo aluno. As respostas marcadas aparecem preenchidas.'
          : 'Versão para impressão. O aluno deverá marcar apenas uma alternativa em cada questão.'}
      </div>

      ${questions}

      <footer class="paper-footer">
        EducaFísica Avalia · ${esc(e.title)}
      </footer>
    </main>
  </body>
  </html>`;
}

async function loadExamPrintableData(env, examId) {
  await ensureQuestionImageTable(env);
  await ensureExamVariantTables(env);
  await ensureRecoveryTables(env);

  const e = await env.DB.prepare(`
    SELECT
      e.*,
      s.name AS school_name,
      c.shift AS shift,
      COALESCE(c.class_name,e.class_name) AS linked_class_name,
      ec.trimester AS trimester
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools s ON s.id=ec.school_id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE e.id=?
  `).bind(examId).first();

  if (!e) return null;

  const settings = await env.DB.prepare(`
    SELECT question_count
    FROM exam_variant_settings
    WHERE exam_id=?
  `).bind(examId).first();

  const limit = Math.max(1, Number(settings?.question_count || 10));

  const qs = await env.DB.prepare(`
    SELECT
      q.*,
      eq.position,
      CASE WHEN qi.question_id IS NULL THEN 0 ELSE 1 END AS has_image,
      COALESCE(qi.alt_text,'') AS image_alt,
      qi.updated_at AS image_updated_at
    FROM exam_questions eq
    JOIN questions q ON q.id=eq.question_id
    LEFT JOIN question_images qi ON qi.question_id=q.id
    WHERE eq.exam_id=?
    ORDER BY eq.position
    LIMIT ?
  `).bind(examId, limit).all();

  return { e, qs: qs.results };
}

async function teacherPrintableExam(env, examId) {
  const data = await loadExamPrintableData(env, examId);

  if (!data) {
    return page('Prova não encontrada', '<p>Prova não encontrada.</p>', 404);
  }

  const relation = await getRecoveryRelation(env, examId);

  return new Response(
    printableExamHtml(data.e, data.qs, {
      isRecovery: relation.role === 'recovery'
    }),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }
  );
}

async function studentPrintableExam(request, env, token) {
  await ensureExamVariantTables(env);
  await ensureQuestionImageTable(env);

  const e = await env.DB.prepare(`
    SELECT
      e.*,
      s.name AS school_name,
      c.shift AS shift,
      COALESCE(c.class_name,e.class_name) AS linked_class_name,
      ec.trimester AS trimester
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools s ON s.id=ec.school_id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE e.token=?
  `).bind(token).first();

  if (!e) {
    return page('Prova não encontrada', '<p>Prova não encontrada.</p>', 404);
  }

  const cookieName = `ea_${e.id}`;
  const cookieToken = readCookie(request, cookieName);

  if (!cookieToken) {
    return page(
      'Cópia indisponível',
      '<div class="login"><h2>Abra esta opção no mesmo aparelho em que a prova foi realizada.</h2></div>',
      403
    );
  }

  const attempt = await env.DB.prepare(`
    SELECT *
    FROM exam_attempts
    WHERE exam_id=? AND attempt_token=? AND status='submitted'
    ORDER BY id DESC
    LIMIT 1
  `).bind(e.id, cookieToken).first();

  if (!attempt) {
    return page(
      'Cópia indisponível',
      '<div class="login"><h2>A cópia só fica disponível depois que a prova é finalizada.</h2></div>',
      403
    );
  }

  const qs = await loadAttemptVariantQuestions(env, attempt.id);

  const saved = await env.DB.prepare(`
    SELECT question_id,answer
    FROM attempt_answers
    WHERE attempt_id=?
  `).bind(attempt.id).all();

  const answers = Object.fromEntries(
    saved.results.map(x => [String(x.question_id), String(x.answer || '')])
  );

  return new Response(
    printableExamHtml(e, qs, {
      studentCopy: true,
      studentName: attempt.student_name,
      answers
    }),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }
  );
}

async function toggleExam(env, id) {
  await env.DB.prepare('UPDATE exams SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').bind(id).run();
  return redirect(`/provas/${id}`);
}


async function deleteExam(env, id) {
  const exam = await env.DB.prepare(
    'SELECT id,title FROM exams WHERE id=?'
  ).bind(id).first();

  if (!exam) return redirect('/');

  await ensureExamVariantTables(env);
  await ensureRecoveryTables(env);

  await env.DB.prepare(`
    DELETE FROM exam_recovery_links
    WHERE original_exam_id=? OR recovery_exam_id=?
  `).bind(id, id).run();

  // Remove apenas dados pertencentes a esta prova.
  await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM attempt_questions
      WHERE attempt_id IN (
        SELECT id FROM exam_attempts WHERE exam_id=?
      )
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM attempt_answers
      WHERE attempt_id IN (
        SELECT id FROM exam_attempts WHERE exam_id=?
      )
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exam_attempts
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM answers
      WHERE submission_id IN (
        SELECT id FROM submissions WHERE exam_id=?
      )
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM submissions
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exam_questions
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exam_context
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exam_variant_settings
      WHERE exam_id=?
    `).bind(id),

    env.DB.prepare(`
      DELETE FROM exams
      WHERE id=?
    `).bind(id)
  ]);

  return redirect('/?msg=deleted');
}


async function publicExam(request, env, token, publicPrefix = '/p') {
  const publicPath = `${publicPrefix}/${token}`;

  const e = await env.DB.prepare(`
    SELECT
      e.*,
      s.name AS school_name,
      c.shift AS shift,
      COALESCE(c.class_name,e.class_name) AS linked_class_name,
      ec.trimester AS trimester
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools s ON s.id=ec.school_id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE e.token=?
  `).bind(token).first();

  if (!e) return page('Link inválido', '<div class="login"><h2>Prova não encontrada.</h2></div>', 404);
  if (!e.active) return page('Prova encerrada', '<div class="login"><h2>O professor encerrou esta prova.</h2></div>', 403);

  await ensureExamVariantTables(env);
  await ensureQuestionImageTable(env);

  const cookieName = `ea_${e.id}`;
  const cookieToken = readCookie(request, cookieName);

  let attempt = cookieToken
    ? await env.DB.prepare(`
        SELECT * FROM exam_attempts
        WHERE exam_id=? AND attempt_token=?
        ORDER BY id DESC LIMIT 1
      `).bind(e.id, cookieToken).first()
    : null;

  const now = Math.floor(Date.now() / 1000);

  // Garante que tentativas antigas/retomadas tenham uma versão individual fixa.
  if (attempt) {
    await ensureAttemptVariant(env, e.id, attempt.id);
  }

  let attemptQs = attempt
    ? await loadAttemptVariantQuestions(env, attempt.id)
    : [];

  // Se o tempo terminou enquanto o aluno estava fora, finaliza usando apenas
  // as questões que pertencem à versão individual daquele aluno.
  if (attempt && attempt.status === 'in_progress' && now >= Number(attempt.deadline_at)) {
    const result = await finalizeAttempt(env, e, attemptQs, attempt, Number(attempt.deadline_at));
    return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, true));
  }

  if (request.method === 'GET') {
    if (!attempt) return page(e.title, studentStartPage(e));

    if (attempt.status === 'submitted') {
      const result = await loadAttemptResult(env, e, attempt, attemptQs.length);
      return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, false));
    }

    const saved = await env.DB.prepare(`
      SELECT question_id,answer
      FROM attempt_answers
      WHERE attempt_id=?
    `).bind(attempt.id).all();

    const savedMap = Object.fromEntries(
      saved.results.map(x => [String(x.question_id), String(x.answer || '')])
    );

    return page(e.title, studentForm(e, attemptQs, attempt, savedMap));
  }

  const f = await request.formData();
  const action = String(f.get('action') || 'submit');

  if (action === 'start') {
    if (attempt && attempt.status === 'in_progress') return redirect(publicPath);

    const name = String(f.get('student_name') || '').trim();
    if (!name) return page(e.title, studentStartPage(e, 'Digite seu nome completo.'), 400);

    const existing = await env.DB.prepare(`
      SELECT id
      FROM submissions
      WHERE exam_id=? AND lower(trim(student_name))=lower(trim(?))
      ORDER BY id DESC LIMIT 1
    `).bind(e.id, name).first();

    if (existing) {
      return page(
        'Prova já realizada',
        `<div class="login"><h2>Esta prova já foi enviada com o nome <b>${esc(name)}</b>.</h2><p>Se houver algum problema, fale com o professor.</p></div>`,
        409
      );
    }

    // Mesmo nome = mesma tentativa, mesmo relógio e mesma versão.
    const previousAttempt = await env.DB.prepare(`
      SELECT *
      FROM exam_attempts
      WHERE exam_id=?
        AND lower(trim(student_name))=lower(trim(?))
        AND status='in_progress'
      ORDER BY id DESC
      LIMIT 1
    `).bind(e.id, name).first();

    if (previousAttempt) {
      await ensureAttemptVariant(env, e.id, previousAttempt.id);
      const previousQs = await loadAttemptVariantQuestions(env, previousAttempt.id);

      if (Math.floor(Date.now() / 1000) >= Number(previousAttempt.deadline_at)) {
        await finalizeAttempt(
          env,
          e,
          previousQs,
          previousAttempt,
          Number(previousAttempt.deadline_at)
        );
      }

      return new Response(null, {
        status: 302,
        headers: {
          Location: publicPath,
          'Set-Cookie': `${cookieName}=${previousAttempt.attempt_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        }
      });
    }

    const attemptToken =
      crypto.randomUUID().replaceAll('-', '') +
      crypto.randomUUID().replaceAll('-', '').slice(0, 12);

    const startedAt = Math.floor(Date.now() / 1000);
    const deadlineAt = startedAt + 50 * 60;

    const inserted = await env.DB.prepare(`
      INSERT INTO exam_attempts
        (exam_id,attempt_token,student_name,started_at,deadline_at,status,suspicious_events)
      VALUES (?,?,?,?,?,'in_progress',0)
    `).bind(e.id, attemptToken, name, startedAt, deadlineAt).run();

    // Aqui nasce a versão individual:
    // questões sorteadas do pool + ordem das questões + ordem A/B/C/D.
    await ensureAttemptVariant(env, e.id, inserted.meta.last_row_id);

    return new Response(null, {
      status: 302,
      headers: {
        Location: publicPath,
        'Set-Cookie': `${cookieName}=${attemptToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
      }
    });
  }

  if (!attempt) {
    if (action === 'autosave' || action === 'event') {
      return jsonResponse({ ok: false, error: 'attempt_not_found' }, 409);
    }

    return page(
      e.title,
      studentStartPage(e, 'Sua sessão não foi encontrada. Inicie a prova novamente.'),
      409
    );
  }

  // Atualiza a versão individual depois de qualquer retomada.
  await ensureAttemptVariant(env, e.id, attempt.id);
  attemptQs = await loadAttemptVariantQuestions(env, attempt.id);

  if (attempt.status === 'submitted') {
    if (action === 'autosave' || action === 'event') {
      return jsonResponse({ ok: false, submitted: true }, 409);
    }

    const result = await loadAttemptResult(env, e, attempt, attemptQs.length);
    return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, false));
  }

  const current = Math.floor(Date.now() / 1000);

  if (current >= Number(attempt.deadline_at)) {
    const result = await finalizeAttempt(env, e, attemptQs, attempt, Number(attempt.deadline_at));

    if (action === 'autosave' || action === 'event') {
      return jsonResponse({ ok: false, expired: true, redirect: publicPath }, 409);
    }

    return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, true));
  }

  if (action === 'autosave') {
    const qid = Number(f.get('question_id'));
    const answer = String(f.get('answer') || '');

    const validQuestion = attemptQs.some(q => Number(q.id) === qid);

    if (!validQuestion || !['A','B','C','D'].includes(answer)) {
      return jsonResponse({ ok: false, error: 'invalid_answer' }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO attempt_answers (attempt_id,question_id,answer,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(attempt_id,question_id)
      DO UPDATE SET answer=excluded.answer, updated_at=excluded.updated_at
    `).bind(attempt.id, qid, answer, current).run();

    return jsonResponse({
      ok: true,
      remaining: Math.max(0, Number(attempt.deadline_at) - current)
    });
  }

  if (action === 'event') {
    await env.DB.prepare(`
      UPDATE exam_attempts
      SET suspicious_events=suspicious_events+1
      WHERE id=? AND status='in_progress'
    `).bind(attempt.id).run();

    const updatedAttempt = await env.DB.prepare(`
      SELECT suspicious_events
      FROM exam_attempts
      WHERE id=?
    `).bind(attempt.id).first();

    const exits = Number(updatedAttempt?.suspicious_events || 0);
    const penalty = examExitPenalty(e, exits);

    return jsonResponse({
      ok: true,
      exits,
      penalty_points: penalty.penalty_points,
      penalty_percent: penalty.penalty_percent
    });
  }

  // Salva as respostas finais da versão individual.
  const finalSave = [];

  for (const q of attemptQs) {
    const answer = String(f.get(`q_${q.id}`) || '');

    if (['A','B','C','D'].includes(answer)) {
      finalSave.push(
        env.DB.prepare(`
          INSERT INTO attempt_answers (attempt_id,question_id,answer,updated_at)
          VALUES (?,?,?,?)
          ON CONFLICT(attempt_id,question_id)
          DO UPDATE SET answer=excluded.answer, updated_at=excluded.updated_at
        `).bind(attempt.id, q.id, answer, current)
      );
    }
  }

  if (finalSave.length) await env.DB.batch(finalSave);

  const result = await finalizeAttempt(env, e, attemptQs, attempt, current);
  return page('Resultado', studentResultPage(e, attempt.student_name, result, attemptQs.length, false));
}



async function ensureRecoveryTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS exam_recovery_links (
      original_exam_id INTEGER PRIMARY KEY,
      recovery_exam_id INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_exam_recovery_recovery
    ON exam_recovery_links (recovery_exam_id)
  `).run();
}

async function getRecoveryRelation(env, examId) {
  await ensureRecoveryTables(env);

  const asOriginal = await env.DB.prepare(`
    SELECT original_exam_id, recovery_exam_id
    FROM exam_recovery_links
    WHERE original_exam_id=?
  `).bind(examId).first();

  if (asOriginal) {
    return {
      role: 'original',
      original_exam_id: Number(asOriginal.original_exam_id),
      recovery_exam_id: Number(asOriginal.recovery_exam_id)
    };
  }

  const asRecovery = await env.DB.prepare(`
    SELECT original_exam_id, recovery_exam_id
    FROM exam_recovery_links
    WHERE recovery_exam_id=?
  `).bind(examId).first();

  if (asRecovery) {
    return {
      role: 'recovery',
      original_exam_id: Number(asRecovery.original_exam_id),
      recovery_exam_id: Number(asRecovery.recovery_exam_id)
    };
  }

  return {
    role: 'standalone',
    original_exam_id: Number(examId),
    recovery_exam_id: null
  };
}

async function createRecoveryExamFromOriginal(env, originalExamId) {
  await ensureRecoveryTables(env);
  await ensureExamVariantTables(env);

  const existing = await env.DB.prepare(`
    SELECT recovery_exam_id
    FROM exam_recovery_links
    WHERE original_exam_id=?
  `).bind(originalExamId).first();

  if (existing) return Number(existing.recovery_exam_id);

  const isRecovery = await env.DB.prepare(`
    SELECT original_exam_id
    FROM exam_recovery_links
    WHERE recovery_exam_id=?
  `).bind(originalExamId).first();

  if (isRecovery) {
    throw new Error('Uma recuperação não pode gerar outra recuperação.');
  }

  const original = await env.DB.prepare(`
    SELECT
      e.*,
      ec.school_id,
      ec.school_class_id,
      ec.trimester,
      c.shift,
      c.class_name AS linked_class_name
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE e.id=?
  `).bind(originalExamId).first();

  if (!original) throw new Error('Avaliação original não encontrada.');

  const originalPool = await env.DB.prepare(`
    SELECT q.id, q.topic
    FROM exam_questions eq
    JOIN questions q ON q.id=eq.question_id
    WHERE eq.exam_id=?
    ORDER BY eq.position
  `).bind(originalExamId).all();

  const originalIds = originalPool.results.map(x => Number(x.id));
  const topics = [...new Set(
    originalPool.results
      .map(x => String(x.topic || '').trim())
      .filter(Boolean)
  )];

  const variant = await env.DB.prepare(`
    SELECT question_count
    FROM exam_variant_settings
    WHERE exam_id=?
  `).bind(originalExamId).first();

  const questionCount = Math.max(
    1,
    Math.min(
      Number(variant?.question_count || originalIds.length || 10),
      100
    )
  );

  const desiredPoolSize = Math.max(
    questionCount,
    Math.min(originalIds.length || questionCount * 3, 220)
  );

  const clauses = [
    'active=1',
    'grade=?',
    '(trimester=0 OR trimester=?)'
  ];
  const binds = [
    String(original.grade || ''),
    Number(original.trimester || 0)
  ];

  if (topics.length) {
    clauses.push(`topic IN (${topics.map(() => '?').join(',')})`);
    binds.push(...topics);
  }

  let pickedIds = [];

  if (originalIds.length) {
    const notIn = originalIds.map(() => '?').join(',');

    const fresh = await env.DB.prepare(`
      SELECT id
      FROM questions
      WHERE ${clauses.join(' AND ')}
        AND id NOT IN (${notIn})
      ORDER BY RANDOM()
      LIMIT ?
    `).bind(
      ...binds,
      ...originalIds,
      desiredPoolSize
    ).all();

    pickedIds = fresh.results.map(x => Number(x.id));
  }

  // Se não houver banco suficiente sem repetição, completa com questões
  // do mesmo conteúdo. Mantém a recuperação utilizável sem inventar questão.
  if (pickedIds.length < desiredPoolSize) {
    const remaining = desiredPoolSize - pickedIds.length;
    const exclusions = [...new Set(pickedIds)];

    let extraSql = `
      SELECT id
      FROM questions
      WHERE ${clauses.join(' AND ')}
    `;
    const extraBinds = [...binds];

    if (exclusions.length) {
      extraSql += ` AND id NOT IN (${exclusions.map(() => '?').join(',')})`;
      extraBinds.push(...exclusions);
    }

    extraSql += ` ORDER BY RANDOM() LIMIT ?`;
    extraBinds.push(remaining);

    const extra = await env.DB.prepare(extraSql)
      .bind(...extraBinds)
      .all();

    pickedIds.push(...extra.results.map(x => Number(x.id)));
  }

  pickedIds = [...new Set(pickedIds)];

  if (pickedIds.length < questionCount) {
    throw new Error(
      `Banco insuficiente para criar a recuperação. São necessárias pelo menos ${questionCount} questões compatíveis.`
    );
  }

  const token = await uniqueExamToken(env);
  const recoveryTitle = `${String(original.title || 'Avaliação')} · Recuperação`;

  const created = await env.DB.prepare(`
    INSERT INTO exams
      (token,title,level,grade,class_name,total_points,active)
    VALUES
      (?,?,?,?,?,?,0)
  `).bind(
    token,
    recoveryTitle,
    original.level,
    original.grade,
    original.linked_class_name || original.class_name || '',
    Number(original.total_points || 100)
  ).run();

  const recoveryId = Number(created.meta.last_row_id);

  await env.DB.batch(
    pickedIds.map((qid, index) =>
      env.DB.prepare(`
        INSERT INTO exam_questions
          (exam_id,question_id,position)
        VALUES
          (?,?,?)
      `).bind(recoveryId, qid, index + 1)
    )
  );

  await env.DB.prepare(`
    INSERT OR REPLACE INTO exam_context
      (exam_id,school_id,school_class_id,trimester)
    VALUES
      (?,?,?,?)
  `).bind(
    recoveryId,
    original.school_id,
    original.school_class_id,
    Number(original.trimester || 0)
  ).run();

  await env.DB.prepare(`
    INSERT OR REPLACE INTO exam_variant_settings
      (exam_id,question_count,randomize_questions,randomize_options)
    VALUES
      (?,?,1,1)
  `).bind(
    recoveryId,
    Math.min(questionCount, pickedIds.length)
  ).run();

  await env.DB.prepare(`
    INSERT INTO exam_recovery_links
      (original_exam_id,recovery_exam_id)
    VALUES
      (?,?)
  `).bind(originalExamId, recoveryId).run();

  return recoveryId;
}

async function createRecoveryForExistingExam(env, examId) {
  try {
    const recoveryId = await createRecoveryExamFromOriginal(env, examId);
    return redirect(`/provas/${recoveryId}`);
  } catch (error) {
    return page(
      'Recuperação',
      nav() + `
        <main>
          <div class="card">
            <h2>Não foi possível criar a recuperação</h2>
            <p>${esc(error.message || String(error))}</p>
            <a class="btn" href="/provas/${examId}">Voltar</a>
          </div>
        </main>
      `,
      400
    );
  }
}

async function ensureExamVariantTables(env) {
  await ensureExamAttemptTables(env);

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS exam_variant_settings (
      exam_id INTEGER PRIMARY KEY,
      question_count INTEGER NOT NULL DEFAULT 10,
      randomize_questions INTEGER NOT NULL DEFAULT 1,
      randomize_options INTEGER NOT NULL DEFAULT 1
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS attempt_questions (
      attempt_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      option_order TEXT NOT NULL DEFAULT 'ABCD',
      PRIMARY KEY (attempt_id,question_id)
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_attempt_questions_attempt_position
    ON attempt_questions (attempt_id,position)
  `).run();
}

function shuffledOptionOrder() {
  const a = ['A','B','C','D'];

  for (let i = a.length - 1; i > 0; i--) {
    const byte = new Uint8Array(1);
    crypto.getRandomValues(byte);
    const j = byte[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a.join('');
}

async function ensureAttemptVariant(env, examId, attemptId) {
  const existing = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM attempt_questions
    WHERE attempt_id=?
  `).bind(attemptId).first();

  if (Number(existing?.c || 0) > 0) return;

  const poolCount = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM exam_questions
    WHERE exam_id=?
  `).bind(examId).first();

  const totalPool = Number(poolCount?.c || 0);
  if (!totalPool) return;

  const settings = await env.DB.prepare(`
    SELECT question_count, randomize_questions, randomize_options
    FROM exam_variant_settings
    WHERE exam_id=?
  `).bind(examId).first();

  // Provas antigas: usa todas as questões existentes, mas já embaralha
  // ordem de questões e alternativas.
  const requested = Math.max(
    1,
    Math.min(
      Number(settings?.question_count || totalPool),
      totalPool
    )
  );

  const randomizeQuestions = settings?.randomize_questions == null
    ? 1
    : Number(settings.randomize_questions);

  const randomizeOptions = settings?.randomize_options == null
    ? 1
    : Number(settings.randomize_options);

  const picked = await env.DB.prepare(`
    SELECT question_id
    FROM exam_questions
    WHERE exam_id=?
    ORDER BY ${randomizeQuestions ? 'RANDOM()' : 'position'}
    LIMIT ?
  `).bind(examId, requested).all();

  if (!picked.results.length) return;

  await env.DB.batch(
    picked.results.map((row, index) =>
      env.DB.prepare(`
        INSERT OR IGNORE INTO attempt_questions
          (attempt_id,question_id,position,option_order)
        VALUES (?,?,?,?)
      `).bind(
        attemptId,
        Number(row.question_id),
        index + 1,
        randomizeOptions ? shuffledOptionOrder() : 'ABCD'
      )
    )
  );
}

async function loadAttemptVariantQuestions(env, attemptId) {
  const rows = await env.DB.prepare(`
    SELECT
      q.*,
      aq.position,
      aq.option_order,
      CASE WHEN qi.question_id IS NULL THEN 0 ELSE 1 END AS has_image,
      COALESCE(qi.alt_text,'') AS image_alt,
      qi.updated_at AS image_updated_at
    FROM attempt_questions aq
    JOIN questions q ON q.id=aq.question_id
    LEFT JOIN question_images qi ON qi.question_id=q.id
    WHERE aq.attempt_id=?
    ORDER BY aq.position
  `).bind(attemptId).all();

  return rows.results.map(row => {
    const order = String(row.option_order || 'ABCD').toUpperCase();
    const safeOrder =
      order.length === 4 &&
      [...order].every(x => ['A','B','C','D'].includes(x)) &&
      new Set(order).size === 4
        ? order
        : 'ABCD';

    const originalOptions = {
      A: row.option_a,
      B: row.option_b,
      C: row.option_c,
      D: row.option_d
    };

    const displayedLetters = ['A','B','C','D'];

    const displayedOptions = {};
    displayedLetters.forEach((displayLetter, index) => {
      displayedOptions[displayLetter] = originalOptions[safeOrder[index]];
    });

    const correctIndex = safeOrder.indexOf(String(row.correct || '').toUpperCase());
    const displayedCorrect = correctIndex >= 0
      ? displayedLetters[correctIndex]
      : String(row.correct || '').toUpperCase();

    return {
      ...row,
      option_a: displayedOptions.A,
      option_b: displayedOptions.B,
      option_c: displayedOptions.C,
      option_d: displayedOptions.D,
      correct: displayedCorrect
    };
  });
}

async function ensureExamAttemptTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS exam_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL,
      attempt_token TEXT NOT NULL UNIQUE,
      student_name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      deadline_at INTEGER NOT NULL,
      submitted_at INTEGER,
      submission_id INTEGER,
      status TEXT NOT NULL DEFAULT 'in_progress',
      suspicious_events INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_token
    ON exam_attempts (exam_id,attempt_token)
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS attempt_answers (
      attempt_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      answer TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (attempt_id,question_id)
    )
  `).run();
}

async function finalizeAttempt(env, e, qs, attempt, finishedAt) {
  const fresh = await env.DB.prepare(
    'SELECT * FROM exam_attempts WHERE id=?'
  ).bind(attempt.id).first();

  if (fresh && fresh.status === 'submitted') {
    return loadAttemptResult(env, e, fresh, qs.length);
  }

  const saved = await env.DB.prepare(`
    SELECT question_id,answer
    FROM attempt_answers
    WHERE attempt_id=?
  `).bind(attempt.id).all();

  const answerMap = new Map(
    saved.results.map(x => [
      Number(x.question_id),
      String(x.answer || '')
    ])
  );

  let correct = 0;

  const answerRows = qs.map(q => {
    const a = answerMap.get(Number(q.id)) || '';
    const ok = a === q.correct ? 1 : 0;
    correct += ok;
    return { q: Number(q.id), a, ok };
  });

  const rawPercent = qs.length
    ? Math.round((correct / qs.length) * 1000) / 10
    : 0;

  const totalPoints = Math.max(0, Number(e.total_points || 100));

  const rawScore = Math.round(
    (rawPercent / 100) * totalPoints * 100
  ) / 100;

  // Usa o número mais recente gravado no servidor.
  const exitCount = Number(
    fresh?.suspicious_events ??
    attempt.suspicious_events ??
    0
  );

  const penalty = examExitPenalty(e, exitCount);

  // A nota nunca fica negativa.
  const appliedPenaltyPoints = Math.min(
    rawScore,
    penalty.penalty_points
  );

  const score = Math.max(
    0,
    Math.round((rawScore - appliedPenaltyPoints) * 100) / 100
  );

  const percent = totalPoints > 0
    ? Math.round((score / totalPoints) * 1000) / 10
    : 0;

  const appliedPenaltyPercent = Math.max(
    0,
    Math.round((rawPercent - percent) * 10) / 10
  );

  const end = Math.min(
    Number(finishedAt || Math.floor(Date.now()/1000)),
    Number(attempt.deadline_at)
  );

  const duration = Math.max(
    0,
    Math.min(50 * 60, end - Number(attempt.started_at))
  );

  const fixedClass = e.linked_class_name || e.class_name || '';

  const r = await env.DB.prepare(`
    INSERT INTO submissions
      (exam_id,student_name,student_class,score,percent,duration_seconds)
    VALUES (?,?,?,?,?,?)
  `).bind(
    e.id,
    attempt.student_name,
    fixedClass,
    score,
    percent,
    duration
  ).run();

  const sid = r.meta.last_row_id;

  if (answerRows.length) {
    await env.DB.batch(
      answerRows.map(x =>
        env.DB.prepare(`
          INSERT INTO answers
            (submission_id,question_id,answer,is_correct)
          VALUES (?,?,?,?)
        `).bind(sid, x.q, x.a, x.ok)
      )
    );
  }

  await env.DB.prepare(`
    UPDATE exam_attempts
    SET status='submitted', submitted_at=?, submission_id=?
    WHERE id=?
  `).bind(
    Math.floor(Date.now()/1000),
    sid,
    attempt.id
  ).run();

  return {
    score,
    percent,
    raw_score: rawScore,
    raw_percent: rawPercent,
    penalty_points: appliedPenaltyPoints,
    penalty_percent: appliedPenaltyPercent,
    penalty_per_exit: penalty.per_exit_points,
    penalty_per_exit_percent: penalty.per_exit_percent,
    correct,
    duration,
    suspicious_events: exitCount
  };
}

async function loadAttemptResult(env, e, attempt, questionCount) {
  const sub = attempt.submission_id
    ? await env.DB.prepare(
        'SELECT * FROM submissions WHERE id=?'
      ).bind(attempt.submission_id).first()
    : null;

  if (!sub) {
    return {
      score: 0,
      percent: 0,
      raw_score: 0,
      raw_percent: 0,
      penalty_points: 0,
      penalty_percent: 0,
      penalty_per_exit: examExitPenalty(e, 1).per_exit_points,
      penalty_per_exit_percent: examExitPenalty(e, 1).per_exit_percent,
      correct: 0,
      duration: 50 * 60,
      suspicious_events: Number(attempt.suspicious_events || 0)
    };
  }

  const c = await env.DB.prepare(`
    SELECT COALESCE(SUM(is_correct),0) AS correct
    FROM answers
    WHERE submission_id=?
  `).bind(sub.id).first();

  const correct = Number(c.correct || 0);

  const rawPercent = questionCount
    ? Math.round((correct / questionCount) * 1000) / 10
    : 0;

  const totalPoints = Math.max(0, Number(e.total_points || 100));

  const rawScore = Math.round(
    (rawPercent / 100) * totalPoints * 100
  ) / 100;

  const finalScore = Number(sub.score || 0);
  const finalPercent = Number(sub.percent || 0);

  // Para resultados antigos, o desconto fica zero caso a nota salva
  // não tenha sido calculada pela política nova.
  const appliedPenaltyPoints = Math.max(
    0,
    Math.round((rawScore - finalScore) * 100) / 100
  );

  const appliedPenaltyPercent = Math.max(
    0,
    Math.round((rawPercent - finalPercent) * 10) / 10
  );

  const policy = examExitPenalty(
    e,
    Number(attempt.suspicious_events || 0)
  );

  return {
    score: finalScore,
    percent: finalPercent,
    raw_score: rawScore,
    raw_percent: rawPercent,
    penalty_points: appliedPenaltyPoints,
    penalty_percent: appliedPenaltyPercent,
    penalty_per_exit: policy.per_exit_points,
    penalty_per_exit_percent: policy.per_exit_percent,
    correct,
    duration: Number(sub.duration_seconds || 0),
    suspicious_events: Number(attempt.suspicious_events || 0)
  };
}


function questionVisualProfile(q = {}, position = 1) {
  const fields = [
    q.topic,
    q.unit_theme,
    q.subtopic,
    q.skill,
    q.statement,
    q.option_a,
    q.option_b,
    q.option_c,
    q.option_d
  ];

  const text = fields
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase();

  const originalTopic = String(
    q.topic ||
    q.unit_theme ||
    q.subtopic ||
    'Educação Física'
  ).trim();

  const has = (...terms) =>
    terms.some(term => text.includes(
      String(term)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'')
        .toLowerCase()
    ));

  let profile = {
    icon: '🏃',
    label: originalTopic || 'Educação Física',
    theme: 'blue',
    family: 'movimento',
    accentWord: 'Movimento',
    pattern: ['🏃','⚽','🏅']
  };

  if (has('futsal')) {
    profile = {
      icon:'⚽', label:'Futsal', theme:'orange',
      family:'esporte', accentWord:'Jogo coletivo',
      pattern:['⚽','🥅','👟']
    };
  } else if (has('futebol')) {
    profile = {
      icon:'⚽', label:'Futebol', theme:'orange',
      family:'esporte', accentWord:'Jogo coletivo',
      pattern:['⚽','🥅','🏃']
    };
  } else if (has('voleibol','volei')) {
    profile = {
      icon:'🏐', label:'Voleibol', theme:'cyan',
      family:'esporte', accentWord:'Rede e cooperação',
      pattern:['🏐','🤲','🏅']
    };
  } else if (has('basquetebol','basquete')) {
    profile = {
      icon:'🏀', label:'Basquetebol', theme:'gold',
      family:'esporte', accentWord:'Invasão e estratégia',
      pattern:['🏀','⛹️','🏅']
    };
  } else if (has('handebol')) {
    profile = {
      icon:'🤾', label:'Handebol', theme:'indigo',
      family:'esporte', accentWord:'Invasão e estratégia',
      pattern:['🤾','🥅','🏃']
    };
  } else if (has('atletismo','corrida','salto','arremesso','lancamento')) {
    profile = {
      icon:'🏃', label:'Atletismo', theme:'blue',
      family:'esporte', accentWord:'Marca e desempenho',
      pattern:['🏃','⏱','🏅']
    };
  } else if (has('natacao','nadar','piscina')) {
    profile = {
      icon:'🏊', label:'Natação', theme:'cyan',
      family:'esporte', accentWord:'Meio aquático',
      pattern:['🏊','💧','⏱']
    };
  } else if (has('luta','judo','jiu-jitsu','taekwondo','karate','capoeira','artes marciais')) {
    profile = {
      icon:'🥋', label:'Lutas e respeito', theme:'green',
      family:'lutas', accentWord:'Respeito e autocontrole',
      pattern:['🥋','🤝','🏅']
    };
  } else if (has('saude','qualidade de vida','alimentacao','sono','sedentarismo','atividade fisica','bem-estar')) {
    profile = {
      icon:'💚', label:'Saúde e qualidade de vida', theme:'purple',
      family:'saude', accentWord:'Cuidado com o corpo',
      pattern:['💚','🥗','💧']
    };
  } else if (has('fisiologia','frequencia cardiaca','vo2','energia','metabolismo','sistema cardiovascular')) {
    profile = {
      icon:'❤️', label:'Fisiologia do exercício', theme:'pink',
      family:'saude', accentWord:'Corpo em movimento',
      pattern:['❤️','🫁','⚡']
    };
  } else if (has('treinamento','forca','resistencia','velocidade','flexibilidade','capacidade fisica','condicionamento')) {
    profile = {
      icon:'💪', label:'Treinamento físico', theme:'indigo',
      family:'treino', accentWord:'Capacidades físicas',
      pattern:['💪','⏱','📈']
    };
  } else if (has('ginastica','alongamento','postura','consciencia corporal')) {
    profile = {
      icon:'🤸', label:'Ginásticas', theme:'pink',
      family:'ginastica', accentWord:'Consciência corporal',
      pattern:['🤸','🧘','✨']
    };
  } else if (has('danca','ritmo','coreografia')) {
    profile = {
      icon:'💃', label:'Danças', theme:'violet',
      family:'danca', accentWord:'Ritmo e cultura',
      pattern:['💃','🎵','✨']
    };
  } else if (has('aventura','escalada','trilha','skate','parkour','orientacao')) {
    profile = {
      icon:'🧗', label:'Práticas de aventura', theme:'teal',
      family:'aventura', accentWord:'Desafio e segurança',
      pattern:['🧗','🧭','⛰️']
    };
  } else if (has('inclusao','paralimp','deficiencia','acessibilidade','adaptado')) {
    profile = {
      icon:'🤝', label:'Inclusão e esporte', theme:'cyan',
      family:'inclusao', accentWord:'Participação para todos',
      pattern:['🤝','♿','🏅']
    };
  } else if (has('doping','fair play','etica','jogo limpo','respeito')) {
    profile = {
      icon:'🏅', label:'Ética e fair play', theme:'gold',
      family:'etica', accentWord:'Respeito no esporte',
      pattern:['🏅','🤝','⚖️']
    };
  } else if (has('midia','padrao estetico','imagem corporal','rede social')) {
    profile = {
      icon:'📱', label:'Corpo, mídia e sociedade', theme:'violet',
      family:'midia', accentWord:'Leitura crítica',
      pattern:['📱','🧠','💬']
    };
  } else if (has('jogo eletronico','e-sport','esport','videogame','games')) {
    profile = {
      icon:'🎮', label:'Jogos eletrônicos', theme:'blue',
      family:'digital', accentWord:'Tecnologia e jogo',
      pattern:['🎮','🕹️','⚡']
    };
  } else if (has('brincadeira','jogos e brincadeiras','cultura popular')) {
    profile = {
      icon:'🪁', label:'Jogos e brincadeiras', theme:'orange',
      family:'jogos', accentWord:'Cultura e diversão',
      pattern:['🪁','🎯','😊']
    };
  }

  // Se o tema cadastrado for mais específico e curto, ele continua aparecendo.
  if (
    originalTopic &&
    originalTopic.length <= 42 &&
    originalTopic.toLowerCase() !== 'educação física' &&
    !profile.label.toLowerCase().includes(originalTopic.toLowerCase())
  ) {
    profile.subLabel = originalTopic;
  } else {
    profile.subLabel = '';
  }

  return {
    ...profile,
    number: Number(position || q.position || 1)
  };
}

function studentStartPage(e, error = '') {
  const penalty = examExitPenalty(e, 1);
  const penaltyPerExitText = formatPenaltyValue(penalty.per_exit_points);

  const school = esc(e.school_name || 'Escola');
  const shift = esc(e.shift || '');
  const className = esc(e.linked_class_name || e.class_name || '');
  const trimester = e.trimester ? `${Number(e.trimester)}º trimestre` : 'Avaliação';
  const grade = esc(e.linked_grade || e.grade || '');

  return `
    <main class="student visual-exam-start">
      <section class="visual-start-hero">
        <div class="visual-sport-pattern" aria-hidden="true">
          <span>⚽</span><span>🏀</span><span>🏃</span><span>🏐</span>
        </div>

        <div class="visual-start-brand">
          <span class="visual-ef-logo">EF</span>
          <div>
            <small>EDUCAFÍSICA AVALIA</small>
            <b>${esc(e.title)}</b>
          </div>
        </div>

        <div class="visual-start-title">
          <span class="visual-start-kicker">AVALIAÇÃO DIGITAL</span>
          <h1>${grade || 'Educação Física'}</h1>
          <p>Leia com atenção, observe as imagens e responda com calma.</p>
        </div>

        <div class="visual-context-chips">
          <span>🏫 ${school}</span>
          ${className ? `<span>👥 Turma ${className}</span>` : ''}
          ${shift ? `<span>◐ ${shift}</span>` : ''}
          <span>📅 ${trimester}</span>
        </div>
      </section>

      ${error ? `<div class="alert">${esc(error)}</div>` : ''}

      <section class="visual-start-grid">
        <article class="visual-time-card">
          <div class="visual-time-icon">⏱</div>
          <div>
            <small>TEMPO TOTAL</small>
            <b>50:00</b>
            <span>minutos</span>
          </div>
          <div class="visual-time-line"><i></i></div>
        </article>

        <article class="visual-rule-card safe">
          <span class="visual-rule-icon">✓</span>
          <div>
            <b>Respostas salvas</b>
            <small>O sistema salva suas escolhas automaticamente.</small>
          </div>
        </article>

        <article class="visual-rule-card version">
          <span class="visual-rule-icon">🔀</span>
          <div>
            <b>Versão individual</b>
            <small>A ordem pode ser diferente da prova dos colegas.</small>
          </div>
        </article>
      </section>

      <section class="visual-security-card">
        <div class="visual-security-shield">🔒</div>
        <div>
          <span>AVALIAÇÃO PROTEGIDA</span>
          <h2>Permaneça na tela da prova.</h2>
          <p>
            Cada saída registrada desconta
            <strong>${penaltyPerExitText} ponto(s)</strong>.
            O relógio continua contando mesmo se a página for fechada.
          </p>
        </div>
      </section>

      <form method="post" class="visual-start-form">
        <input type="hidden" name="action" value="start">

        <div class="visual-name-field">
          <label for="student_name">Seu nome completo</label>
          <div>
            <span>👤</span>
            <input id="student_name"
                   name="student_name"
                   autocomplete="name"
                   required
                   placeholder="Digite seu nome completo">
          </div>
        </div>

        <label class="visual-ack-row">
          <input type="checkbox" required>
          <span>
            Li as orientações e sei que o tempo não pausa e que sair da tela
            pode gerar desconto na minha nota.
          </span>
        </label>

        <button class="visual-start-button" type="submit">
          <span>Iniciar prova</span>
          <b>50 minutos</b>
          <i>→</i>
        </button>
      </form>

      <div class="visual-start-tip">
        <span>💡</span>
        <div>
          <b>Dica</b>
          <small>Leia o enunciado inteiro e observe a imagem antes de marcar a resposta.</small>
        </div>
      </div>
    </main>

    <style>
      .visual-exam-start{max-width:980px;padding-bottom:34px}
      .visual-start-hero{position:relative;overflow:hidden;border-radius:28px;padding:24px;color:white;background:linear-gradient(125deg,#0d5ce8,#0f73f5 58%,#0ca6cf);box-shadow:0 20px 48px rgba(21,91,206,.22)}
      .visual-sport-pattern{position:absolute;inset:0;pointer-events:none;opacity:.1}
      .visual-sport-pattern span{position:absolute;font-size:54px}.visual-sport-pattern span:nth-child(1){right:8%;top:10%}.visual-sport-pattern span:nth-child(2){right:26%;bottom:-10px}.visual-sport-pattern span:nth-child(3){left:46%;top:7%}.visual-sport-pattern span:nth-child(4){left:7%;bottom:-16px}
      .visual-start-brand{position:relative;z-index:1;display:flex;align-items:center;gap:10px}
      .visual-ef-logo{width:53px;height:53px;border-radius:17px;display:grid;place-items:center;font-weight:950;font-size:23px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}
      .visual-start-brand>div{display:flex;flex-direction:column}.visual-start-brand small{font-size:7px;letter-spacing:1px;opacity:.75;font-weight:900}.visual-start-brand b{font-size:13px;margin-top:2px}
      .visual-start-title{position:relative;z-index:1;margin:28px 0 19px;max-width:650px}.visual-start-kicker{font-size:8px;font-weight:900;letter-spacing:1.3px;color:#bfe0ff}.visual-start-title h1{font-size:clamp(32px,6vw,50px);margin:5px 0 7px;letter-spacing:-1.7px}.visual-start-title p{margin:0;font-size:12px;color:#d7ebff}
      .visual-context-chips{position:relative;z-index:1;display:flex;flex-wrap:wrap;gap:7px}.visual-context-chips span{padding:7px 10px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.16);font-size:8px;font-weight:800}
      .visual-start-grid{display:grid;grid-template-columns:1.2fr .9fr .9fr;gap:9px;margin:12px 0}
      .visual-time-card,.visual-rule-card{background:white;border:1px solid #e2e8f0;border-radius:18px;padding:14px;box-shadow:0 8px 24px rgba(35,57,89,.06)}
      .visual-time-card{display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:center;position:relative;overflow:hidden}.visual-time-icon{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:#eaf3ff;color:#1765d9;font-size:23px}.visual-time-card>div:nth-child(2){display:flex;flex-direction:column}.visual-time-card small{font-size:7px;font-weight:900;color:#79869a}.visual-time-card b{font-size:28px;color:#122348;line-height:1}.visual-time-card span{font-size:7px;color:#8591a3}.visual-time-line{grid-column:1/-1;height:5px;border-radius:999px;background:#edf1f6;overflow:hidden}.visual-time-line i{display:block;width:100%;height:100%;background:linear-gradient(90deg,#15a76d,#3ecb8d)}
      .visual-rule-card{display:flex;align-items:center;gap:9px}.visual-rule-icon{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;flex:none}.visual-rule-card>div{display:flex;flex-direction:column}.visual-rule-card b{font-size:10px}.visual-rule-card small{font-size:7px;color:#7b8798;line-height:1.4;margin-top:2px}.visual-rule-card.safe .visual-rule-icon{background:#eaf8f1;color:#258263}.visual-rule-card.version .visual-rule-icon{background:#f0edff;color:#7158c6}
      .visual-security-card{display:flex;align-items:center;gap:12px;border:1px solid #f1d69b;background:linear-gradient(135deg,#fffaf0,#fff5df);border-radius:18px;padding:14px 16px;margin-bottom:12px}.visual-security-shield{width:49px;height:49px;border-radius:15px;display:grid;place-items:center;background:#fff0c8;font-size:23px;flex:none}.visual-security-card>div:last-child{display:flex;flex-direction:column}.visual-security-card span{font-size:7px;font-weight:950;letter-spacing:.8px;color:#a66d16}.visual-security-card h2{font-size:15px;margin:2px 0}.visual-security-card p{font-size:9px;color:#735b35;margin:0;line-height:1.5}.visual-security-card strong{color:#b4413c}
      .visual-start-form{background:white;border:1px solid #e2e8f0;border-radius:20px;padding:17px;box-shadow:0 10px 30px rgba(35,57,89,.065)}
      .visual-name-field>label{display:block;font-size:9px;font-weight:900;color:#607087;margin:0 0 6px 3px}.visual-name-field>div{display:flex;align-items:center;gap:8px;border:1px solid #dce4ee;background:#f8fafc;border-radius:13px;padding:0 10px}.visual-name-field>div>span{font-size:17px}.visual-name-field input{border:0!important;box-shadow:none!important;background:transparent!important;padding:13px 0!important}
      .visual-ack-row{display:flex!important;flex-direction:row!important;gap:8px;align-items:flex-start!important;margin:12px 2px!important;font-size:9px!important;color:#69778b!important;line-height:1.45}.visual-ack-row input{width:auto!important;margin-top:2px}
      .visual-start-button{width:100%;border-radius:14px!important;padding:12px 14px!important;display:grid!important;grid-template-columns:1fr auto auto!important;gap:8px!important;align-items:center!important;background:linear-gradient(135deg,#1266e8,#1985f2)!important;box-shadow:0 11px 26px rgba(22,103,232,.23)!important}.visual-start-button span{text-align:left;font-size:12px}.visual-start-button b{font-size:8px;opacity:.8}.visual-start-button i{font-style:normal;font-size:18px}
      .visual-start-tip{display:flex;gap:8px;align-items:center;margin-top:10px;padding:10px 12px;border-radius:13px;background:#eef6ff;border:1px solid #d9e8fa}.visual-start-tip>span{font-size:20px}.visual-start-tip>div{display:flex;flex-direction:column}.visual-start-tip b{font-size:9px;color:#2463bb}.visual-start-tip small{font-size:7px;color:#718198;margin-top:1px}
      @media(max-width:700px){.visual-start-grid{grid-template-columns:1fr 1fr}.visual-time-card{grid-column:1/-1}.visual-start-hero{padding:20px}.visual-start-title{margin-top:24px}}
      @media(max-width:450px){.visual-start-grid{grid-template-columns:1fr}.visual-time-card{grid-column:auto}.visual-context-chips{gap:5px}.visual-context-chips span{font-size:7px;padding:6px 8px}.visual-security-card{align-items:flex-start}}
    </style>
  `;
}

function studentForm(e, qs, attempt, savedMap = {}) {
  const totalQuestionCount = qs.length;
  const answeredInitial = qs.filter(q => Boolean(savedMap[String(q.id)])).length;

  const exitPolicy = examExitPenalty(
    e,
    Number(attempt.suspicious_events || 0)
  );
  const penaltyPerExitText = formatPenaltyValue(
    exitPolicy.per_exit_points
  );
  const currentPenaltyText = formatPenaltyValue(
    exitPolicy.penalty_points
  );

  const context = [
    e.school_name,
    e.shift,
    e.linked_class_name || e.class_name,
    e.trimester ? `${e.trimester}º trimestre` : null
  ].filter(Boolean).map(esc).join(' · ');

  const student = esc(attempt.student_name);
  const watermarkText = `${student} · ${esc(e.linked_class_name || e.class_name || '')}`;

  return `
    <main class="student exam-secure visual-exam" id="secureExam">
      <div class="exam-watermarks" aria-hidden="true">
        <span>${watermarkText}</span><span>${watermarkText}</span><span>${watermarkText}</span>
        <span>${watermarkText}</span><span>${watermarkText}</span><span>${watermarkText}</span>
      </div>

      <section class="visual-exam-header">
        <div class="visual-exam-header-pattern" aria-hidden="true">
          <span>⚽</span><span>🏀</span><span>🏐</span>
        </div>

        <div class="visual-exam-brand">
          <span class="visual-ef-mini">EF</span>
          <div>
            <small>EDUCAFÍSICA AVALIA</small>
            <b>${esc(e.title)}</b>
          </div>
        </div>

        <div class="visual-exam-context">
          ${e.school_name ? `<span>🏫 ${esc(e.school_name)}</span>` : ''}
          <span>👥 Turma ${esc(e.linked_class_name || e.class_name || '')}</span>
          ${e.trimester ? `<span>📅 ${Number(e.trimester)}º trimestre</span>` : ''}
        </div>
      </section>

      <section class="visual-sticky-control" id="timerBar">
        <div class="visual-timer">
          <span class="visual-timer-icon">⏱</span>
          <div>
            <small>TEMPO RESTANTE</small>
            <b id="timer">50:00</b>
          </div>
        </div>

        <div class="visual-progress-wrap">
          <div>
            <small>PROGRESSO</small>
            <b id="answeredCount">${answeredInitial} de ${totalQuestionCount} respondida(s)</b>
          </div>
          <div class="visual-progress-track">
            <i id="examProgressFill" style="width:${totalQuestionCount ? Math.round(answeredInitial / totalQuestionCount * 100) : 0}%"></i>
          </div>
        </div>

        <span id="saveState" class="visual-save-state">✓ Salvo</span>
      </section>

      <section class="visual-exam-student">
        <div>
          <span>👤</span>
          <div><small>ALUNO</small><b>${student}</b></div>
        </div>
        <div>
          <span>🔀</span>
          <div><small>VERSÃO</small><b>Individual</b></div>
        </div>
      </section>

      <section class="visual-protection-row">
        <div class="visual-protected-box">
          <span>🔒</span>
          <div>
            <b>Avaliação protegida</b>
            <small>Não saia da tela. Seu nome aparece como marca d'água.</small>
          </div>
        </div>

        <div class="visual-exit-box">
          <span>⚠</span>
          <div>
            <b>${penaltyPerExitText} ponto(s) por saída</b>
            <small id="exitPenaltyLive">${Number(attempt.suspicious_events || 0)} saída(s) · -${currentPenaltyText} ponto(s)</small>
          </div>
        </div>
      </section>

      <section class="visual-question-nav">
        <div>
          <small>QUESTÕES</small>
          <b>Toque nos números para navegar</b>
        </div>
        <div class="visual-question-dots">
          ${qs.map(q => `
            <a href="#question-${q.id}"
               data-progress-q="${q.id}"
               class="${savedMap[String(q.id)] ? 'answered' : ''}">
              ${q.position}
            </a>
          `).join('')}
        </div>
      </section>

      <form method="post" id="examForm" class="visual-exam-form">
        <input type="hidden" name="action" value="submit">

        ${qs.map((q, idx) => {
          const visual = questionVisualProfile(q, q.position);
          return `
            <section class="visual-question-card visual-theme-${visual.theme} ${q.has_image ? 'with-photo' : 'without-photo'}" id="question-${q.id}">
              <div class="visual-question-topline">
                <div class="visual-question-number">
                  <span>${q.position}</span>
                  <div>
                    <small>QUESTÃO</small>
                    <b>${q.position} de ${totalQuestionCount}</b>
                  </div>
                </div>

                <div class="visual-topic-badge" title="${attr(visual.subLabel || visual.label)}">
                  <span>${visual.icon}</span>
                  <div>
                    <b>${esc(visual.label)}</b>
                    ${visual.subLabel ? `<small>${esc(visual.subLabel)}</small>` : ''}
                  </div>
                </div>
              </div>

              ${q.has_image ? `
                <figure class="visual-question-photo">
                  <div class="visual-photo-label">
                    <span>${visual.icon}</span>
                    <div>
                      <small>LEITURA VISUAL</small>
                      <b>${esc(visual.label)}</b>
                    </div>
                  </div>
                  <img src="/imagem/q/${q.id}?v=${q.image_updated_at || 0}"
                       loading="lazy"
                       alt="${attr(q.image_alt || 'Imagem relacionada à questão')}">
                  ${q.image_alt ? `<figcaption>${esc(q.image_alt)}</figcaption>` : ''}
                </figure>
              ` : `
                <div class="visual-question-placeholder visual-family-${visual.family}">
                  <div class="visual-placeholder-pattern" aria-hidden="true">
                    ${visual.pattern.map(x => `<span>${x}</span>`).join('')}
                  </div>
                  <span class="visual-placeholder-icon">${visual.icon}</span>
                  <div>
                    <small>${esc(visual.accentWord)}</small>
                    <b>${esc(visual.label)}</b>
                    ${visual.subLabel ? `<em>${esc(visual.subLabel)}</em>` : ''}
                  </div>
                </div>
              `}

              <div class="visual-question-body">
                <h2>${esc(q.statement)}</h2>

                <div class="visual-answers">
                  ${['A','B','C','D'].map(x => `
                    <label class="visual-answer">
                      <input
                        type="radio"
                        name="q_${q.id}"
                        value="${x}"
                        data-qid="${q.id}"
                        ${savedMap[String(q.id)] === x ? 'checked' : ''}
                        required
                      >
                      <span class="visual-answer-letter">${x}</span>
                      <span class="visual-answer-text">${esc(q['option_' + x.toLowerCase()])}</span>
                      <i>✓</i>
                    </label>
                  `).join('')}
                </div>
              </div>
            </section>`;
        }).join('')}

        <section class="visual-finish-card">
          <span>🏆</span>
          <div>
            <b>Terminou?</b>
            <small>Revise suas respostas antes de enviar. Depois do envio, a prova será encerrada.</small>
          </div>
          <button class="visual-submit-button" id="submitBtn">
            Enviar prova <i>→</i>
          </button>
        </section>
      </form>

      <div class="focus-warning" id="focusWarning">
        <div>
          <span class="visual-warning-big">⚠️</span>
          <b>Esta saída foi registrada.</b>
          <p id="focusWarningText">O relógio continuou contando e a saída gera desconto na nota.</p>
          <button type="button" id="closeFocusWarning">Voltar para a prova</button>
        </div>
      </div>
    </main>

    <style>
      .visual-exam{max-width:1050px;padding-bottom:40px;-webkit-user-select:none;user-select:none}
      .visual-exam input,.visual-exam button{user-select:auto}
      .visual-exam-header{position:relative;overflow:hidden;border-radius:25px;padding:19px 21px;color:white;background:linear-gradient(125deg,#075eea,#0b76ef 58%,#0ca8cc);box-shadow:0 17px 38px rgba(18,94,206,.2);z-index:2}
      .visual-exam-header-pattern{position:absolute;inset:0;opacity:.1;pointer-events:none}.visual-exam-header-pattern span{position:absolute;font-size:49px}.visual-exam-header-pattern span:nth-child(1){right:6%;top:-8px}.visual-exam-header-pattern span:nth-child(2){right:24%;bottom:-16px}.visual-exam-header-pattern span:nth-child(3){left:49%;top:6px}
      .visual-exam-brand,.visual-exam-context{position:relative;z-index:1}.visual-exam-brand{display:flex;align-items:center;gap:9px}.visual-ef-mini{width:45px;height:45px;border-radius:14px;display:grid;place-items:center;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.18);font-weight:950;font-size:19px}.visual-exam-brand>div{display:flex;flex-direction:column}.visual-exam-brand small{font-size:6.5px;letter-spacing:1px;opacity:.75;font-weight:900}.visual-exam-brand b{font-size:14px;margin-top:2px}
      .visual-exam-context{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.visual-exam-context span{padding:6px 8px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.14);font-size:7px;font-weight:800}
      .visual-sticky-control{position:sticky;top:7px;z-index:80;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;margin:9px 0;padding:9px 11px;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);border:1px solid #dfe7f1;border-radius:16px;box-shadow:0 10px 25px rgba(35,57,89,.1)}
      .visual-timer{display:flex;align-items:center;gap:7px}.visual-timer-icon{width:36px;height:36px;border-radius:11px;background:#eaf3ff;color:#1e68d7;display:grid;place-items:center;font-size:18px}.visual-timer>div{display:flex;flex-direction:column}.visual-timer small,.visual-progress-wrap small{font-size:6px;font-weight:950;color:#7c8899;letter-spacing:.4px}.visual-timer b{font-size:22px;color:#10254b;line-height:1}
      .visual-progress-wrap{display:grid;gap:4px}.visual-progress-wrap>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:8px}.visual-progress-wrap b{font-size:8px;color:#56667d}.visual-progress-track{height:6px;border-radius:999px;background:#e9eef4;overflow:hidden}.visual-progress-track i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#18a66d,#42cf91);transition:width .25s ease}.visual-save-state{font-size:7px;font-weight:900;color:#318065;background:#eaf8f1;border-radius:999px;padding:6px 8px;white-space:nowrap}.visual-sticky-control.urgent{border-color:#efb8bd;background:#fff4f4}.visual-sticky-control.urgent .visual-timer-icon{background:#ffe1e4;color:#c23c46}.visual-sticky-control.urgent .visual-timer b{color:#b92f39}
      .visual-exam-student{position:relative;z-index:2;display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px}.visual-exam-student>div{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:13px;background:white;border:1px solid #e2e8f0}.visual-exam-student>div>span{width:31px;height:31px;border-radius:9px;background:#edf4ff;display:grid;place-items:center}.visual-exam-student>div>div{display:flex;flex-direction:column}.visual-exam-student small{font-size:6px;color:#8290a3;font-weight:900}.visual-exam-student b{font-size:9px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px}
      .visual-protection-row{position:relative;z-index:2;display:grid;grid-template-columns:1.2fr .8fr;gap:7px;margin-bottom:7px}.visual-protected-box,.visual-exit-box{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:13px}.visual-protected-box{background:#fff8e9;border:1px solid #efd89f;color:#7f5e19}.visual-exit-box{background:#fff0f0;border:1px solid #edc5c8;color:#963940}.visual-protected-box>span,.visual-exit-box>span{width:31px;height:31px;border-radius:9px;display:grid;place-items:center;background:rgba(255,255,255,.65);flex:none}.visual-protected-box>div,.visual-exit-box>div{display:flex;flex-direction:column}.visual-protected-box b,.visual-exit-box b{font-size:9px}.visual-protected-box small,.visual-exit-box small{font-size:7px;line-height:1.35;margin-top:1px}
      .visual-question-nav{position:relative;z-index:2;background:white;border:1px solid #e2e8f0;border-radius:14px;padding:9px 10px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:10px}.visual-question-nav>div:first-child{display:flex;flex-direction:column}.visual-question-nav small{font-size:6px;font-weight:900;color:#7b8799}.visual-question-nav b{font-size:8px}.visual-question-dots{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}.visual-question-dots a{width:25px;height:25px;border-radius:8px;display:grid;place-items:center;background:#f1f4f8;color:#66758a;font-size:8px;font-weight:900;border:1px solid #e3e8ef}.visual-question-dots a.answered{background:#eaf8f1;color:#268064;border-color:#cbe8db}
      .visual-exam-form{position:relative;z-index:2;display:grid;gap:10px}.visual-question-card{--accent:#2473e9;--soft:#edf5ff;--border:#cfe0fa;background:white;border:1px solid #e1e7ef;border-left:5px solid var(--accent);border-radius:20px;padding:13px;box-shadow:0 8px 24px rgba(38,58,87,.055);scroll-margin-top:90px}.visual-theme-green{--accent:#27a36f;--soft:#eaf8f1;--border:#c9e8d9}.visual-theme-purple{--accent:#795bd3;--soft:#f1edff;--border:#ded4ff}.visual-theme-orange{--accent:#f08a18;--soft:#fff3e4;--border:#f5d5ac}.visual-theme-pink{--accent:#d25b8b;--soft:#fff0f6;--border:#f0ccda}.visual-theme-violet{--accent:#8657ce;--soft:#f3edff;--border:#ded1f5}.visual-theme-teal{--accent:#269b9b;--soft:#eaf8f8;--border:#cae8e8}.visual-theme-indigo{--accent:#4f61d5;--soft:#eef0ff;--border:#d4d8fa}.visual-theme-cyan{--accent:#218eae;--soft:#eaf7fb;--border:#cae4ed}.visual-theme-gold{--accent:#bc8a1f;--soft:#fff7e6;--border:#efdda9}
      .visual-question-topline{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.visual-question-number{display:flex;align-items:center;gap:7px}.visual-question-number>span{width:33px;height:33px;border-radius:10px;background:var(--accent);color:white;display:grid;place-items:center;font-size:13px;font-weight:950}.visual-question-number>div{display:flex;flex-direction:column}.visual-question-number small{font-size:5.5px;color:#8793a5;font-weight:900}.visual-question-number b{font-size:8px;color:#536178}
      .visual-topic-badge{display:flex;align-items:center;gap:5px;padding:6px 8px;border-radius:999px;background:var(--soft);border:1px solid var(--border);color:var(--accent);max-width:65%}.visual-topic-badge>span{font-size:12px}.visual-topic-badge>div{display:flex;flex-direction:column;min-width:0}.visual-topic-badge b{font-size:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.visual-topic-badge small{font-size:5.5px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .visual-question-photo{position:relative;margin:0 0 11px;border-radius:15px;overflow:hidden;border:1px solid #e1e7ef;background:#eef2f7}.visual-photo-label{position:absolute;z-index:2;left:9px;top:9px;display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:11px;background:rgba(255,255,255,.91);backdrop-filter:blur(9px);box-shadow:0 5px 16px rgba(25,47,78,.12);color:var(--accent)}.visual-photo-label>span{font-size:14px}.visual-photo-label>div{display:flex;flex-direction:column}.visual-photo-label small{font-size:5px;font-weight:950;color:#7b8798}.visual-photo-label b{font-size:7.5px}.visual-question-photo img{display:block;width:100%;height:min(330px,38vw);min-height:180px;object-fit:cover}.visual-question-photo figcaption{padding:7px 9px;background:white;border-top:1px solid #e6ebf1;font-size:7px;color:#758297}
      .visual-question-placeholder{height:104px;border-radius:15px;margin-bottom:10px;background:linear-gradient(135deg,var(--soft),#fff);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;gap:10px;overflow:hidden;position:relative}.visual-question-placeholder:after{content:"";position:absolute;width:150px;height:150px;border-radius:50%;right:-52px;top:-80px;background:var(--accent);opacity:.055}.visual-placeholder-pattern{position:absolute;inset:0;pointer-events:none;opacity:.08}.visual-placeholder-pattern span{position:absolute;font-size:35px}.visual-placeholder-pattern span:nth-child(1){left:8%;top:14%}.visual-placeholder-pattern span:nth-child(2){right:14%;bottom:8%}.visual-placeholder-pattern span:nth-child(3){right:36%;top:7%;font-size:24px}.visual-placeholder-icon{position:relative;z-index:1;width:54px;height:54px;border-radius:17px;display:grid;place-items:center;background:rgba(255,255,255,.76);box-shadow:0 6px 18px rgba(29,53,84,.08);font-size:30px}.visual-question-placeholder>div:last-child{position:relative;z-index:1;display:flex;flex-direction:column;max-width:65%}.visual-question-placeholder small{font-size:6px;color:#8590a2;font-weight:900;text-transform:uppercase;letter-spacing:.45px}.visual-question-placeholder b{font-size:13px;color:var(--accent);line-height:1.2}.visual-question-placeholder em{font-size:6.5px;color:#7b8798;font-style:normal;margin-top:2px}
      .visual-question-body h2{font-size:15px;line-height:1.48;color:#14233f;margin:2px 0 12px}.visual-answers{display:grid;gap:6px}.visual-answer{display:grid!important;grid-template-columns:31px 1fr 22px!important;gap:8px!important;align-items:center!important;border:1px solid #e0e6ee;border-radius:12px;padding:7px 8px!important;background:#fbfcfe;cursor:pointer;transition:.15s ease;margin:0!important}.visual-answer:hover{border-color:var(--border);background:var(--soft)}.visual-answer input{position:absolute;opacity:0;pointer-events:none}.visual-answer-letter{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:#edf1f6;color:#52647a;font-size:9px;font-weight:950}.visual-answer-text{font-size:10px;line-height:1.35;color:#34445b}.visual-answer>i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#eaf8f1;color:#258263;font-style:normal;font-size:8px;opacity:0;transform:scale(.7);transition:.15s}.visual-answer:has(input:checked){border-color:var(--accent);background:var(--soft);box-shadow:inset 0 0 0 1px var(--border)}.visual-answer:has(input:checked) .visual-answer-letter{background:var(--accent);color:white}.visual-answer:has(input:checked)>i{opacity:1;transform:scale(1)}
      .visual-finish-card{display:grid;grid-template-columns:45px 1fr auto;gap:10px;align-items:center;background:linear-gradient(135deg,#f7fbff,#eef5ff);border:1px solid #d5e4f7;border-radius:18px;padding:13px;margin-top:2px}.visual-finish-card>span{width:43px;height:43px;border-radius:13px;background:white;display:grid;place-items:center;font-size:22px}.visual-finish-card>div{display:flex;flex-direction:column}.visual-finish-card b{font-size:11px}.visual-finish-card small{font-size:7px;color:#718198;line-height:1.4;margin-top:2px}.visual-submit-button{border-radius:12px!important;padding:10px 13px!important;background:linear-gradient(135deg,#1466df,#2184ed)!important;white-space:nowrap!important}.visual-submit-button i{font-style:normal;margin-left:6px}
      .exam-watermarks{position:fixed;inset:0;z-index:1;pointer-events:none;overflow:hidden;display:grid;grid-template-columns:repeat(2,1fr);align-content:space-around;justify-items:center;opacity:.055}.exam-watermarks span{font-size:17px;font-weight:900;transform:rotate(-28deg);white-space:nowrap;color:#10213d}
      .focus-warning{position:fixed;inset:0;background:rgba(10,20,36,.84);backdrop-filter:blur(8px);z-index:1000;display:none;align-items:center;justify-content:center;padding:20px}.focus-warning.show{display:flex}.focus-warning>div{max-width:420px;background:#fff;border-radius:20px;padding:24px;text-align:center}.visual-warning-big{display:block;font-size:35px;margin-bottom:6px}.focus-warning b{font-size:20px}.focus-warning p{color:#667386;font-size:10px}.focus-warning button{margin-top:5px}
      @media print{body{display:none!important}}
      @media(max-width:720px){.visual-question-photo img{height:245px;min-height:0}.visual-sticky-control{grid-template-columns:auto 1fr}.visual-save-state{display:none}.visual-protection-row{grid-template-columns:1fr}.visual-question-nav{align-items:flex-start;flex-direction:column}.visual-question-dots{justify-content:flex-start}.visual-exam-student b{max-width:180px}}
      @media(max-width:480px){.visual-exam-header{padding:16px}.visual-exam-context span{font-size:6px}.visual-sticky-control{gap:8px}.visual-timer-icon{display:none}.visual-timer b{font-size:20px}.visual-progress-wrap b{font-size:7px}.visual-exam-student{grid-template-columns:1fr}.visual-question-card{padding:11px;border-radius:17px}.visual-question-photo img{height:205px}.visual-question-body h2{font-size:14px}.visual-answer{grid-template-columns:28px 1fr 18px!important;padding:7px!important}.visual-answer-letter{width:26px;height:26px}.visual-answer-text{font-size:9px}.visual-finish-card{grid-template-columns:38px 1fr}.visual-finish-card>span{width:36px;height:36px}.visual-submit-button{grid-column:1/-1;width:100%}.visual-topic-badge{max-width:60%}}
    </style>

    <script>
      (() => {
        const deadline = ${Number(attempt.deadline_at)} * 1000;
        const timer = document.getElementById('timer');
        const timerBar = document.getElementById('timerBar');
        const form = document.getElementById('examForm');
        const submitBtn = document.getElementById('submitBtn');
        const saveState = document.getElementById('saveState');
        const focusWarning = document.getElementById('focusWarning');
        const focusWarningText = document.getElementById('focusWarningText');
        const closeFocusWarning = document.getElementById('closeFocusWarning');
        const exitPenaltyLive = document.getElementById('exitPenaltyLive');
        const penaltyPerExit = ${Number(exitPolicy.per_exit_points)};
        const answeredCountEl = document.getElementById('answeredCount');
        const progressFill = document.getElementById('examProgressFill');
        const questionDots = [...document.querySelectorAll('[data-progress-q]')];
        let exitCount = ${Number(attempt.suspicious_events || 0)};
        let submitting = false;
        let eventSentAt = 0;

        function penaltyText(value) {
          const n = Math.round(Number(value || 0) * 100) / 100;
          return Number.isInteger(n)
            ? String(n)
            : n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'').replace('.', ',');
        }

        function updateExitPenalty() {
          const deduction = exitCount * penaltyPerExit;
          exitPenaltyLive.textContent =
            exitCount + ' saída(s) · -' +
            penaltyText(deduction) + ' ponto(s)';

          focusWarningText.textContent =
            'O relógio continuou contando. Saídas registradas: ' +
            exitCount + '. Desconto acumulado estimado: -' +
            penaltyText(deduction) + ' ponto(s).';
        }

        function fmt(ms) {
          const total = Math.max(0, Math.ceil(ms / 1000));
          const m = Math.floor(total / 60);
          const s = total % 60;
          return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
        }

        function updateTimer() {
          const left = deadline - Date.now();
          timer.textContent = fmt(left);
          if (left <= 5 * 60 * 1000) timerBar.classList.add('urgent');
          if (left <= 0 && !submitting) {
            submitting = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Tempo encerrado · enviando...';
            form.submit();
          }
        }

        async function postSmall(data) {
          try {
            return await fetch(location.href, {
              method: 'POST',
              body: new URLSearchParams(data),
              credentials: 'same-origin',
              keepalive: true,
              headers: {'Accept':'application/json'}
            });
          } catch (_) {
            return null;
          }
        }

        function updateProgress() {
          const answeredIds = new Set(
            [...document.querySelectorAll('input[type="radio"][data-qid]:checked')]
              .map(x => String(x.dataset.qid))
          );

          answeredCountEl.textContent =
            answeredIds.size + ' de ${totalQuestionCount} respondida(s)';

          const pct = ${totalQuestionCount} > 0
            ? Math.round((answeredIds.size / ${totalQuestionCount}) * 100)
            : 0;

          progressFill.style.width = pct + '%';

          questionDots.forEach(dot => {
            dot.classList.toggle(
              'answered',
              answeredIds.has(String(dot.dataset.progressQ))
            );
          });
        }

        document.querySelectorAll('input[type="radio"][data-qid]').forEach(input => {
          input.addEventListener('change', async () => {
            updateProgress();
            saveState.textContent = 'Salvando...';
            const res = await postSmall({
              action: 'autosave',
              question_id: input.dataset.qid,
              answer: input.value
            });
            if (res && res.ok) {
              saveState.textContent = '✓ Resposta salva';
            } else {
              saveState.textContent = '⚠ Verifique sua conexão';
            }
          });
        });

        form.addEventListener('submit', () => {
          submitting = true;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Enviando prova...';
        });

        // Dificulta cópia/impressão. Em navegador comum, nenhum site consegue impedir screenshot do sistema operacional com 100% de garantia.
        ['copy','cut','contextmenu','dragstart'].forEach(type => {
          document.addEventListener(type, ev => ev.preventDefault());
        });

        document.addEventListener('keydown', ev => {
          const key = String(ev.key || '').toLowerCase();
          if ((ev.ctrlKey || ev.metaKey) && ['c','p','s','u'].includes(key)) {
            ev.preventDefault();
          }
          if (key === 'printscreen') {
            ev.preventDefault();
            navigator.clipboard?.writeText?.('');
          }
        });

        async function registerExit() {
          const now = Date.now();
          if (now - eventSentAt < 2500) return;

          eventSentAt = now;
          exitCount += 1;
          updateExitPenalty();

          const res = await postSmall({
            action:'event',
            kind:'page_hidden'
          });

          if (res && res.ok) {
            try {
              const data = await res.json();

              if (Number.isFinite(Number(data.exits))) {
                exitCount = Number(data.exits);
                updateExitPenalty();
              }
            } catch (_) {}
          }
        }

        document.addEventListener('visibilitychange', () => {
          if (document.hidden && !submitting) {
            registerExit();
          } else if (!document.hidden && !submitting) {
            updateExitPenalty();
            focusWarning.classList.add('show');
          }
        });

        closeFocusWarning.addEventListener('click', () => focusWarning.classList.remove('show'));

        updateProgress();
        updateExitPenalty();
        updateTimer();
        setInterval(updateTimer, 250);
      })();
    </script>

  `;
}

function studentResultPage(e, name, result, totalQuestions, expired = false) {
  const fixedClass = e.linked_class_name || e.class_name || '';
  const grade100 = Math.round(Number(result.percent || 0) * 10) / 10;
  const rawGrade100 = Math.round(
    Number(result.raw_percent ?? result.percent ?? 0) * 10
  ) / 10;
  const exits = Number(result.suspicious_events || 0);
  const penaltyPercent = Math.round(
    Number(result.penalty_percent || 0) * 10
  ) / 10;
  const penaltyPoints = Math.round(
    Number(result.penalty_points || 0) * 100
  ) / 100;
  const gradeText = Number.isInteger(grade100)
    ? String(grade100)
    : grade100.toFixed(1).replace('.', ',');

  let message = '';
  let messageIcon = '💙';

  if (grade100 === 100) {
    message = 'Excelente! Parabéns! Você alcançou 100 pontos. Continue brilhando!';
    messageIcon = '🏆';
  } else if (grade100 > 80) {
    message = 'Parabéns! Rumo ao topo!';
    messageIcon = '🚀';
  } else if (grade100 >= 60) {
    message = 'Muito bem! Continue avançando!';
    messageIcon = '👏';
  } else {
    message = 'Vamos melhorar, você consegue!';
    messageIcon = '💪';
  }

  const gradeClass = grade100 >= 60 ? 'grade-blue' : 'grade-red';
  const pointInfo = Number(e.total_points) === 100
    ? ''
    : `<p class="points-detail">Pontuação da prova: <b>${result.score}</b> de <b>${e.total_points}</b> pontos</p>`;

  return `
    <main class="student result-page">
      <section class="result-student-card">
        <div class="result-check">${expired ? '⏱️' : '✓'}</div>

        <span class="eyebrow blue">EDUCAFÍSICA AVALIA</span>
        <h1>${expired ? 'Tempo encerrado!' : 'Prova concluída!'}</h1>
        <p class="result-student-name">${esc(name)}</p>
        <p class="result-context">${esc(fixedClass)}${e.school_name ? ` · ${esc(e.school_name)}` : ''}</p>

        ${expired ? `
          <div class="result-time-alert">
            O limite de 50 minutos foi atingido. Foram consideradas as respostas salvas até o fim do tempo.
          </div>
        ` : ''}

        <div class="student-grade-box ${gradeClass}">
          <small>SUA NOTA</small>
          <div class="student-grade-number">${gradeText}</div>
          <span>de 100</span>
        </div>

        <div class="student-feedback ${gradeClass}">
          <span class="feedback-emoji">${messageIcon}</span>
          <b>${message}</b>
        </div>

        <div class="result-details-grid">
          <div>
            <small>Acertos</small>
            <b>${result.correct}/${totalQuestions}</b>
          </div>
          <div>
            <small>Nota pelas respostas</small>
            <b>${formatPenaltyValue(rawGrade100)}/100</b>
          </div>
          <div>
            <small>Tempo utilizado</small>
            <b>${formatDuration(result.duration)}</b>
          </div>
        </div>

        <div class="result-exit-penalty ${exits > 0 ? 'has-exit' : 'no-exit'}">
          <div>
            <span>↗</span>
            <div>
              <small>SAÍDAS DA TELA</small>
              <b>${exits}</b>
            </div>
          </div>
          <div>
            <small>DESCONTO NA NOTA</small>
            <b>${exits > 0 ? '-' + formatPenaltyValue(penaltyPercent) : '0'}/100</b>
            <span>${exits > 0 ? `(${formatPenaltyValue(penaltyPoints)} ponto(s) do valor da prova)` : 'Nenhum desconto'}</span>
          </div>
        </div>

        ${pointInfo}
        <div class="student-result-actions">
          <a class="student-pdf-button" href="/e/${attr(e.token)}/imprimir" target="_blank">
            ⬇ <span>Baixar / imprimir minha prova</span>
          </a>
          <small>A cópia mostra sua versão individual e as respostas que você marcou.</small>
        </div>


        <p class="result-final-note">Sua avaliação foi registrada com sucesso.</p>
      </section>
    </main>
  `;
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const part = cookie.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return part ? part.slice(name.length + 1) : '';
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function examResults(env, id) {
  await ensureExamAttemptTables(env);
  const e = await env.DB.prepare(`
    SELECT
      e.*,
      s.name AS school_name,
      c.shift AS shift,
      COALESCE(c.class_name,e.class_name) AS linked_class_name,
      COALESCE(c.grade,e.grade) AS linked_grade,
      ec.trimester AS trimester
    FROM exams e
    LEFT JOIN exam_context ec ON ec.exam_id=e.id
    LEFT JOIN schools s ON s.id=ec.school_id
    LEFT JOIN school_classes c ON c.id=ec.school_class_id
    WHERE e.id=?
  `).bind(id).first();

  if (!e) return page('Erro', '<p>Prova não encontrada.</p>', 404);

  const subs = await env.DB.prepare(`
    SELECT
      su.*,
      COALESCE(ea.suspicious_events,0) AS suspicious_events,
      COALESCE(SUM(a.is_correct),0) AS correct_answers,
      COUNT(a.question_id) AS total_answers
    FROM submissions su
    LEFT JOIN exam_attempts ea ON ea.submission_id=su.id
    LEFT JOIN answers a ON a.submission_id=su.id
    WHERE su.exam_id=?
    GROUP BY su.id
    ORDER BY su.student_name COLLATE NOCASE
  `).bind(id).all();

  const st = await env.DB.prepare(`
    SELECT
      COUNT(*) AS n,
      ROUND(AVG(percent),1) AS avg_score,
      ROUND(MAX(percent),1) AS max_score,
      ROUND(MIN(percent),1) AS min_score
    FROM submissions
    WHERE exam_id=?
  `).bind(id).first();

  const qs = await env.DB.prepare(`
    SELECT
      q.id,
      q.statement,
      q.topic,
      eq.position,
      COUNT(a.submission_id) AS total,
      COALESCE(SUM(a.is_correct),0) AS correct,
      CASE
        WHEN COUNT(a.submission_id)=0 THEN 0
        ELSE ROUND(100.0*SUM(a.is_correct)/COUNT(a.submission_id),1)
      END AS pct
    FROM exam_questions eq
    JOIN questions q ON q.id=eq.question_id
    LEFT JOIN answers a
      ON a.question_id=q.id
      AND a.submission_id IN (
        SELECT id FROM submissions WHERE exam_id=?
      )
    WHERE eq.exam_id=?
    GROUP BY q.id,q.statement,q.topic,eq.position
    ORDER BY eq.position
  `).bind(id, id).all();

  const context = [
    e.school_name,
    e.shift,
    e.linked_class_name || e.class_name,
    e.trimester ? `${e.trimester}º trimestre` : null
  ].filter(Boolean).map(esc).join(' · ');

  const rows = subs.results.map((s, index) => {
    const note = Number(s.percent || 0);
    const noteText = Number.isInteger(note) ? String(note) : note.toFixed(1).replace('.', ',');
    const noteClass = note >= 60 ? 'table-note-blue' : 'table-note-red';
    const rawPercent = Number(s.total_answers || 0)
      ? Math.round(
          (Number(s.correct_answers || 0) / Number(s.total_answers || 1)) * 1000
        ) / 10
      : 0;
    const appliedDiscount = Math.max(
      0,
      Math.round((rawPercent - note) * 10) / 10
    );
    const exits = Number(s.suspicious_events || 0);

    return `
      <tr>
        <td>
          <div class="result-student-cell">
            <span class="student-number">${index + 1}</span>
            <b>${esc(s.student_name)}</b>
          </div>
        </td>
        <td><span class="class-table-chip">${esc(e.linked_class_name || e.class_name || s.student_class || '')}</span></td>
        <td><span class="table-note ${noteClass}">${noteText}<small>/100</small></span></td>
        <td><b>${Number(s.correct_answers || 0)}</b> de <b>${Number(s.total_answers || 0)}</b></td>
        <td>${formatDuration(s.duration_seconds)}</td>
        <td>
          <span class="exit-result-pill ${exits > 0 ? 'with-exit' : 'clean'}">
            <b>${exits}</b> saída(s)
            ${appliedDiscount > 0 ? `<small>-${formatPenaltyValue(appliedDiscount)} na nota</small>` : '<small>sem desconto</small>'}
          </span>
        </td>
      </tr>`;
  }).join('');

  const bars = qs.results.map(q => {
    const pct = Math.max(0, Math.min(100, Number(q.pct || 0)));
    const level = pct >= 70 ? 'good' : pct >= 50 ? 'mid' : 'low';
    return `
      <div class="bar-row performance-card">
        <div class="bar-label">
          <span><b>Q${q.position}</b> · ${esc(q.topic)}</span>
          <b class="pct-badge ${level}">${q.pct}%</b>
        </div>
        <div class="bar ${level}"><i style="width:${pct}%"></i></div>
        <small>${esc(q.statement)}</small>
      </div>
    `;
  }).join('');

  return page(
    'Resultados',
    nav() + `
      <main>
        <section class="results-header">
          <div>
            <span class="eyebrow blue">RESULTADOS DA TURMA</span>
            <h1>${esc(e.title)}</h1>
            <p>${context}</p>
          </div>
          <a class="btn secondary" href="/provas/${id}">← Voltar à prova</a>
        </section>

        <div class="cards dashboard-stats">
          <div class="card stat stat-blue"><span class="stat-icon">👥</span><b>${st.n || 0}</b><span>Alunos</span></div>
          <div class="card stat stat-purple"><span class="stat-icon">📊</span><b>${st.avg_score ?? '—'}</b><span>Média da turma /100</span></div>
          <div class="card stat stat-green"><span class="stat-icon">🏆</span><b>${st.max_score ?? '—'}</b><span>Maior nota /100</span></div>
          <div class="card stat stat-orange"><span class="stat-icon">📍</span><b>${st.min_score ?? '—'}</b><span>Menor nota /100</span></div>
        </div>

        <div class="card">
          <div class="card-heading-row">
            <div>
              <span class="eyebrow blue">DIAGNÓSTICO</span>
              <h2>Desempenho por questão</h2>
            </div>
            <span class="legend"><i class="legend-good"></i> ≥70% <i class="legend-mid"></i> 50–69% <i class="legend-low"></i> &lt;50%</span>
          </div>
          ${bars || '<p>Ainda não há respostas.</p>'}
        </div>

        <div class="card">
          <div class="card-heading-row">
            <div>
              <span class="eyebrow blue">ALUNOS</span>
              <h2>Notas da turma ${esc(e.linked_class_name || e.class_name || '')}</h2>
            </div>
            <a class="btn small secondary" href="/provas/${id}/resultados.csv">Baixar CSV</a>
          </div>

          <div class="table">
            <table>
              <thead>
                <tr><th>Aluno</th><th>Turma</th><th>Nota final /100</th><th>Acertos</th><th>Tempo</th><th>Saídas / desconto</th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="6">Ainda não há respostas.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </main>
    `
  );
}

async function resultsCsv(env, id) {
  const subs = await env.DB.prepare('SELECT * FROM submissions WHERE exam_id=? ORDER BY student_name').bind(id).all();
  const lines = ['Nome;Turma;Nota;Percentual;Tempo (s);Enviado em'];
  for (const s of subs.results) {
    const rawPercent = Number(s.total_answers || 0)
      ? Math.round((Number(s.correct_answers || 0) / Number(s.total_answers || 1)) * 1000) / 10
      : Number(s.percent || 0);
    const discount = Math.max(0, Math.round((rawPercent - Number(s.percent || 0)) * 10) / 10);

    lines.push([
      s.student_name,
      s.student_class,
      String(s.score).replace('.', ','),
      String(s.percent).replace('.', ',') + '%',
      s.duration_seconds || '',
      Number(s.suspicious_events || 0),
      String(discount).replace('.', ',') + '%',
      s.submitted_at
    ].map(csvSafe).join(';'));
  }
  return new Response('\ufeff' + lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="resultados_prova_${id}.csv"` } });
}

function nav() {
  return `<header class="topbar">
    <a class="brand" href="/"><span class="brand-mark">EF</span><span><b>EducaFísica</b><small>Avalia</small></span></a>
    <nav class="navlinks">
      <a href="/" title="Painel"><span class="nav-ico">🏠</span><span class="nav-txt">Painel</span></a>
      <a href="/provas/nova" title="Criar prova"><span class="nav-ico">📝</span><span class="nav-txt">Criar</span></a>
      <a href="/banco" title="Banco de questões"><span class="nav-ico">📚</span><span class="nav-txt">Banco</span></a>
      <a href="/resultados" title="Resultados"><span class="nav-ico">📊</span><span class="nav-txt">Resultados</span></a>
      <a href="/alunos" title="Alunos"><span class="nav-ico">👨‍🎓</span><span class="nav-txt">Alunos</span></a>
      <a href="/medias-finais" title="Médias finais"><span class="nav-ico">⭐</span><span class="nav-txt">Médias</span></a>
      <a href="/caderno" title="Caderno RCO"><span class="nav-ico">📒</span><span class="nav-txt">Caderno</span></a>
      <button type="button"
              class="install-app-link"
              id="installAppBtn"
              title="Instalar aplicativo"
              aria-label="Instalar aplicativo">
        <span class="nav-ico">📲</span><span class="nav-txt">App</span>
      </button>
      <a class="logout-link"
         href="/logout"
         title="Sair do sistema"
         aria-label="Sair do sistema">
        <span class="nav-ico">🚪</span><span class="nav-txt">Sair</span>
      </a>
    </nav>
  </header>`;
}

function page(title, body, status = 200) {
  return new Response(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#10264a">
  <meta name="application-name" content="EducaFísica Avalia">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="EF Avalia">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" type="image/png" sizes="192x192" href="/app-icon-192.png">
  <link rel="apple-touch-icon" href="/app-icon-192.png">
  <title>${esc(title)} · EducaFísica Avalia</title>
  ${css()}
</head>
<body>
  ${body}

  <script>
    (() => {
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
        });
      }

      let installPrompt = null;
      const installButton = document.getElementById('installAppBtn');

      const isStandalone =
        window.matchMedia &&
        window.matchMedia('(display-mode: standalone)').matches;

      if (installButton && !isStandalone) {
        window.addEventListener('beforeinstallprompt', event => {
          event.preventDefault();
          installPrompt = event;
          installButton.classList.add('available');
        });

        installButton.addEventListener('click', async () => {
          if (!installPrompt) {
            alert(
              'Para instalar: abra o menu ⋮ do Chrome e toque em "Instalar app" ou "Adicionar à tela inicial".'
            );
            return;
          }

          installPrompt.prompt();

          try {
            await installPrompt.userChoice;
          } catch (_) {}

          installPrompt = null;
          installButton.classList.remove('available');
        });

        window.addEventListener('appinstalled', () => {
          installPrompt = null;
          installButton.classList.remove('available');
        });
      }

      if (installButton && isStandalone) {
        installButton.style.display = 'none';
      }
    })();
  </script>
</body>
</html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store'
    }
  });
}

function css() {
  return `<style>
    :root{
      --primary:#2367f2;--primary2:#4a8cff;--navy:#13233d;--navy2:#1d365a;
      --green:#20ae68;--purple:#7459df;--orange:#ee9238;--red:#de5858;
      --ink:#172033;--muted:#6f7b91;--bg:#f3f6fb;--line:#e2e8f1;--white:#fff;
      --shadow:0 12px 34px rgba(24,48,82,.08);--shadow2:0 18px 50px rgba(24,48,82,.14)
    }
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,Arial,Helvetica,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
    a{text-decoration:none;color:var(--primary)}small{color:var(--muted)}
    .topbar{position:sticky;top:0;z-index:60;height:72px;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 max(18px,calc((100vw - 1160px)/2));box-shadow:0 3px 15px rgba(23,32,51,.04)}
    .brand{display:flex;align-items:center;gap:12px;color:var(--ink)}.brand-mark{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),#5d9cff);color:white;font-weight:900;font-size:20px;box-shadow:0 8px 18px rgba(35,103,242,.2)}
    .brand>span:last-child{display:flex;flex-direction:column;line-height:1.02}.brand b{font-size:17px}.brand small{font-size:12px;color:var(--primary);font-weight:800;letter-spacing:.6px}
    .navlinks{display:flex;gap:6px;align-items:center;flex-wrap:nowrap}.navlinks a,.navlinks .install-app-link{color:#556176;font-weight:800;font-size:14px;padding:10px 12px;border-radius:14px;display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.55);border:1px solid transparent}.navlinks a:hover,.navlinks .install-app-link:hover{background:#eef4ff;color:var(--primary);border-color:#d8e6ff}.nav-ico{font-size:20px;line-height:1;display:grid;place-items:center;min-width:22px}.nav-txt{font-size:14px;letter-spacing:.1px}.navlinks .install-app-link{border:1px solid #dce8ff;background:#f7fbff;box-shadow:none;cursor:pointer;color:#2b6bd3}.navlinks .install-app-link:not(.available){opacity:.72}.navlinks .logout-link{color:#b3424a;background:#fff1f2;border:1px solid #f1d0d3}.navlinks .logout-link:hover{background:#ffe8ea;color:#9d3038;border-color:#efc3c8}
    main{max-width:1160px;margin:26px auto 50px;padding:0 18px}
    .welcome-panel,.results-header,.hero{display:flex;justify-content:space-between;gap:22px;align-items:center;margin-bottom:18px}.hero{background:white;border:1px solid var(--line);border-radius:20px;padding:22px;box-shadow:var(--shadow)}.hero h1,.results-header h1{margin:4px 0 6px;font-size:clamp(26px,4vw,38px);letter-spacing:-1px}.hero p,.results-header p{margin:0;color:var(--muted)}
    .v7-welcome{position:relative;overflow:hidden;min-height:250px;border-radius:28px;padding:32px;background:linear-gradient(125deg,#1856d9 0%,#2367f2 47%,#1aa96a 140%);color:white;box-shadow:0 20px 50px rgba(35,103,242,.22)}.v7-welcome:before{content:"";position:absolute;width:340px;height:340px;border-radius:50%;background:rgba(255,255,255,.08);right:-100px;top:-150px}.v7-welcome:after{content:"";position:absolute;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.06);right:130px;bottom:-110px}.welcome-copy{position:relative;z-index:2;max-width:660px}.v7-welcome h1{font-size:clamp(31px,5vw,48px);letter-spacing:-1.5px;margin:8px 0}.v7-welcome p{font-size:16px;color:rgba(255,255,255,.84);line-height:1.5}.welcome-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.welcome-mark{position:relative;z-index:2;width:132px;height:132px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.12);backdrop-filter:blur(7px);border-radius:34px;display:grid;place-items:center;font-size:48px;font-weight:900}.welcome-mark span{position:absolute;right:14px;bottom:10px;width:36px;height:36px;border-radius:50%;background:white;color:var(--green);display:grid;place-items:center;font-size:19px}
    .eyebrow{display:inline-block;font-size:10px;letter-spacing:1.3px;font-weight:900;color:var(--muted)}.eyebrow.blue{color:var(--primary)}.eyebrow.white{color:rgba(255,255,255,.78)}
    .btn,button{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--primary),var(--primary2));color:#fff;padding:12px 17px;font-weight:850;font-size:14px;cursor:pointer;box-shadow:0 7px 18px rgba(35,103,242,.18)}.btn:hover,button:hover{filter:brightness(.98)}.btn.light{background:white;color:var(--primary);box-shadow:none}.btn.glass{background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.22);box-shadow:none}.secondary{background:white!important;color:var(--ink)!important;border:1px solid var(--line)!important;box-shadow:none!important}.small{padding:8px 11px;font-size:12px}.big{width:100%;font-size:16px;padding:15px}
    .quick-actions{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:16px 0 18px}.quick-card{background:white;border:1px solid var(--line);border-radius:17px;padding:15px;display:flex;align-items:center;gap:11px;color:var(--ink);box-shadow:0 6px 18px rgba(24,48,82,.05);transition:.15s}.quick-card:hover{transform:translateY(-2px);box-shadow:var(--shadow)}.quick-icon{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;flex:none}.quick-icon.blue{background:#e9f1ff;color:var(--primary)}.quick-icon.purple{background:#f0ecff;color:var(--purple)}.quick-icon.green{background:#e7f8ef;color:var(--green)}.quick-icon.orange{background:#fff2e6;color:var(--orange)}.quick-icon.red{background:#ffeded;color:var(--red)}.danger-card{border-color:#ffd7d7}.danger-card:hover{border-color:#f1a8a8}.quick-card>div{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}.quick-card b{font-size:14px}.quick-card small{font-size:11px}.quick-card i{font-style:normal;font-size:22px;color:#a2aec0}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:white;border:1px solid var(--line);border-radius:18px;padding:19px;margin-bottom:15px;box-shadow:0 7px 22px rgba(24,48,82,.055)}.stat{position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:126px;justify-content:flex-end}.stat:after{content:"";position:absolute;width:95px;height:95px;border-radius:50%;right:-30px;top:-35px;opacity:.07;background:currentColor}.stat b{font-size:31px;line-height:1;margin-top:10px}.stat>span:last-child{color:var(--muted);font-size:12px;margin-top:4px}.stat-icon{font-size:20px}.stat-blue{color:var(--primary)}.stat-purple{color:var(--purple)}.stat-green{color:var(--green)}.stat-orange{color:var(--orange)}
    .section-heading{margin:28px 2px 14px}.section-heading.split{display:flex;justify-content:space-between;gap:14px;align-items:end}.section-heading h2{margin:4px 0;font-size:25px}.section-heading p{margin:0;color:var(--muted);font-size:13px}.search-box{min-width:300px;background:white;border:1px solid var(--line);border-radius:12px;display:flex;align-items:center;gap:7px;padding:0 11px}.search-box span{font-size:20px;color:#8996aa}.search-box input{border:0;box-shadow:none;padding:11px 4px}
    .school-list{display:grid;gap:14px}details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}.school-group,.school-result-group{background:white;border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--shadow)}.school-group>summary,.school-result-group>summary{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:18px;cursor:pointer;background:linear-gradient(135deg,#fff,#f8fbff)}.school-summary-main{display:flex;align-items:center;gap:13px;min-width:0}.school-icon{width:50px;height:50px;border-radius:14px;background:#eaf2ff;display:grid;place-items:center;font-size:23px;flex:none}.school-icon.v7{position:relative}.school-icon.v7 small{position:absolute;right:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;background:var(--navy);color:white;display:grid;place-items:center;font-size:8px}.school-group h2,.school-result-group h2{margin:3px 0 4px;font-size:17px}.school-group p,.school-result-group p{margin:0;color:var(--muted);font-size:12px}.summary-chevron{font-size:26px;color:#8ba0bc;transition:.2s}details[open]>summary .summary-chevron{transform:rotate(90deg)}.school-content{padding:0 17px 17px}.shift-block,.result-shift{border-top:1px solid var(--line);padding-top:15px;margin-top:2px}.shift-title{display:flex;align-items:center;gap:9px;margin-bottom:10px}.shift-title h3{margin:1px 0 0;font-size:14px}.shift-icon{width:34px;height:34px;border-radius:10px;background:#f2f6fc;display:grid;place-items:center}
    .class-group{border:1px solid var(--line);border-radius:14px;margin:9px 0;background:#fbfcfe;overflow:hidden}.class-group>summary{cursor:pointer;padding:12px 13px;display:flex;align-items:center;gap:10px}.class-group>summary>span:nth-child(2){display:flex;flex-direction:column;gap:2px;flex:1}.class-avatar{min-width:38px;height:38px;padding:0 7px;border-radius:10px;background:#e9f1ff;color:var(--primary);display:grid;place-items:center;font-weight:900;font-size:12px}.exam-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:0 12px 12px}.exam-card{display:block;border:1px solid var(--line);border-radius:13px;padding:14px;background:white;color:var(--ink);transition:.15s}.exam-card:hover{transform:translateY(-1px);border-color:#bfd2f8;box-shadow:0 9px 20px rgba(35,103,242,.08)}.exam-card-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.exam-card h4{margin:6px 0 10px;font-size:15px;line-height:1.35}.mini-chip{display:inline-flex;background:#edf4ff;color:var(--primary);font-size:9px;font-weight:900;letter-spacing:.6px;padding:4px 6px;border-radius:6px}.status-pill{white-space:nowrap;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:850}.status-pill.open{background:#e8f8ef;color:#16814a}.status-pill.closed{background:#eef1f5;color:#667386}.exam-metrics{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:11px}.exam-metrics b{color:var(--ink)}.card-arrow{border-top:1px solid var(--line);margin-top:11px;padding-top:9px;color:var(--primary);font-size:11px;font-weight:800}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.span{grid-column:1/-1}label{display:flex;flex-direction:column;gap:7px;font-weight:750;font-size:13px}input,select,textarea{width:100%;padding:12px;border:1px solid #cfd8e6;border-radius:11px;font:inherit;background:white;outline:none}input:focus,select:focus,textarea:focus{border-color:#7aa9ff;box-shadow:0 0 0 3px rgba(35,103,242,.1)}textarea{min-height:95px}.question-list{display:grid;gap:9px}.pick,.answer{display:flex;flex-direction:row;align-items:flex-start;border:1px solid var(--line);border-radius:12px;padding:12px;font-weight:500;background:#fff}.pick input,.answer input{width:auto;margin-top:4px;margin-right:10px}.answer:hover{border-color:#a9c7ff;background:#f8fbff}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions form{margin:0}.mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mode-card{display:flex;flex-direction:row;align-items:flex-start;gap:10px;border:1px solid var(--line);border-radius:13px;padding:14px;cursor:pointer;background:#fff}.mode-card input{width:auto;margin-top:4px}.info-box,.filter-note{margin-top:12px;padding:12px;border-radius:11px;background:#f0f6ff;color:#41516b}
    .table{overflow:auto;border:1px solid var(--line);border-radius:13px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:11px;border-bottom:1px solid var(--line);text-align:left}th{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.45px;background:#f8faff}tbody tr:hover{background:#f8fbff}
    .login{width:min(440px,calc(100% - 30px));margin:70px auto;background:white;padding:31px;border-radius:24px;box-shadow:var(--shadow2);text-align:center}.login:before{content:"EF";display:grid;place-items:center;margin:0 auto 15px;width:58px;height:58px;border-radius:17px;background:linear-gradient(135deg,var(--primary),var(--green));color:white;font-size:20px;font-weight:900}.login form{display:grid;gap:12px;text-align:left;margin-top:20px}.alert{background:#fff0f0;color:#a42b2b;padding:11px;border-radius:10px;margin:12px 0}.success{width:64px;height:64px;border-radius:50%;background:#e6f8ee;color:var(--green);display:grid;place-items:center;margin:auto;font-size:35px;font-weight:900}.grade{margin:18px 0;background:#f6f8fb;border-radius:15px;padding:19px;display:flex;flex-direction:column}.grade b{font-size:54px}
    .reset-page{max-width:720px}.reset-card{background:white;border:1px solid var(--line);border-radius:26px;padding:30px;box-shadow:var(--shadow2);text-align:center}.reset-icon{width:68px;height:68px;border-radius:20px;background:#ffeded;color:var(--red);display:grid;place-items:center;margin:0 auto 14px;font-size:34px;font-weight:900}.red-text{color:var(--red)}.reset-card h1{margin:8px 0 7px;font-size:clamp(28px,6vw,40px)}.reset-lead{max-width:560px;margin:0 auto 20px;color:var(--muted);line-height:1.55}.reset-summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.reset-summary>div{background:#f7f9fc;border:1px solid var(--line);border-radius:15px;padding:15px;display:flex;flex-direction:column;gap:6px}.reset-summary small{color:var(--muted);font-size:11px;text-transform:uppercase}.reset-summary b{font-size:30px}.reset-warning,.reset-safe{text-align:left;border-radius:15px;padding:14px 16px;margin:12px 0}.reset-warning{background:#fff0f0;border:1px solid #ffd2d2;color:#8d2d2d}.reset-safe{background:#edf8f2;border:1px solid #ccebd9;color:#176f47}.reset-warning p,.reset-safe p{margin:5px 0 0;line-height:1.45}.reset-form{display:grid;gap:12px;margin-top:20px;text-align:left}.reset-form label{display:grid;gap:7px}.danger-button{background:linear-gradient(135deg,#d94747,#b92d2d)!important;box-shadow:0 7px 18px rgba(185,45,45,.2)!important}.reset-success{background:#fff7e8;border:1px solid #f2d796;color:#795a12;border-radius:13px;padding:12px;margin:14px 0}.success-reset p{line-height:1.55}
    .result-page{max-width:680px}.result-student-card{background:white;border:1px solid var(--line);border-radius:28px;padding:30px;text-align:center;box-shadow:var(--shadow2);overflow:hidden}.result-check{width:70px;height:70px;border-radius:22px;background:linear-gradient(135deg,#eaf2ff,#e8f8ef);color:var(--primary);display:grid;place-items:center;margin:0 auto 14px;font-size:36px;font-weight:900}.result-student-card h1{margin:7px 0 5px;font-size:clamp(28px,6vw,42px);letter-spacing:-1px}.result-student-name{font-size:18px;font-weight:850;margin:8px 0 3px}.result-context{color:var(--muted);margin:0 0 18px;font-size:13px}.result-time-alert{background:#fff7e8;color:#6d551e;border:1px solid #f4dfad;border-radius:13px;padding:12px;margin:14px 0;text-align:left}.student-grade-box{border-radius:24px;padding:22px 18px;margin:19px auto 13px;display:flex;flex-direction:column;align-items:center;justify-content:center;max-width:330px;border:2px solid currentColor}.student-grade-box small{font-size:11px;font-weight:900;letter-spacing:1.6px;color:inherit}.student-grade-number{font-size:clamp(68px,18vw,98px);font-weight:950;line-height:.95;letter-spacing:-4px;margin:8px 0 3px}.student-grade-box>span{font-weight:800;font-size:14px;opacity:.8}.grade-blue{color:#1764d8}.student-grade-box.grade-blue{background:#edf5ff}.grade-red{color:#c93636}.student-grade-box.grade-red{background:#fff0f0}.student-feedback{max-width:440px;margin:0 auto 20px;border-radius:15px;padding:14px 16px;display:flex;align-items:center;justify-content:center;gap:9px;font-size:17px}.student-feedback.grade-blue{background:#eaf3ff}.student-feedback.grade-red{background:#ffeded}.feedback-emoji{font-size:25px}.result-details-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:18px}.result-details-grid>div{background:#f7f9fc;border:1px solid var(--line);border-radius:14px;padding:13px 8px;display:flex;flex-direction:column;gap:5px}.result-details-grid small{font-size:10px;text-transform:uppercase;letter-spacing:.5px}.result-details-grid b{font-size:18px}.points-detail{color:var(--muted);font-size:13px;margin:15px 0 0}.result-exit-penalty{margin:13px 0;display:grid;grid-template-columns:1fr 1.35fr;gap:8px;border-radius:14px;padding:10px;background:#f7f9fc;border:1px solid #e3e8ef}.result-exit-penalty>div{display:flex;align-items:center;gap:8px}.result-exit-penalty>div:last-child{flex-direction:column;align-items:flex-start;justify-content:center}.result-exit-penalty>div>span:first-child{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#edf1f6;font-size:17px}.result-exit-penalty small{font-size:8px;font-weight:900;color:#78859a}.result-exit-penalty b{font-size:17px}.result-exit-penalty>div:last-child>span{font-size:8px;color:#78859a}.result-exit-penalty.has-exit{background:#fff0f0;border-color:#efc7ca;color:#9c343d}.result-exit-penalty.has-exit>div>span:first-child{background:#ffe1e3}.result-exit-penalty.no-exit{background:#edf8f3;border-color:#cde9dc;color:#33745f}@media(max-width:520px){.result-exit-penalty{grid-template-columns:1fr}}
.result-final-note{margin:18px 0 0;color:var(--green);font-weight:800}

    .student{max-width:780px}.student-head{display:flex;gap:12px;align-items:center}.student-head.modern{background:white;border:1px solid var(--line);border-radius:20px;padding:20px;margin-bottom:16px;box-shadow:var(--shadow)}.student-head h1{margin:3px 0 4px}.student-head p{margin:0;color:var(--muted)}.logo-box{min-width:54px;width:54px;height:54px;border-radius:15px;background:linear-gradient(135deg,var(--primary),var(--green));display:grid;place-items:center;color:white;font-weight:900;box-shadow:0 8px 18px rgba(35,103,242,.2)}.student-id-card{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;align-items:end}.fixed-class{background:#f5f8fd;border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:3px}.fixed-class span,.fixed-class small{font-size:11px;color:var(--muted)}.fixed-class b{font-size:22px;color:var(--primary)}.question-card h2{font-size:18px;line-height:1.45}.qnum{font-size:10px;color:var(--primary);font-weight:900;text-transform:uppercase;letter-spacing:.7px}
    .results-header{background:white;border:1px solid var(--line);border-radius:24px;padding:24px;box-shadow:var(--shadow)}.v7-results-hero{background:linear-gradient(125deg,var(--navy),#235081);color:white}.v7-results-hero p{color:rgba(255,255,255,.76)}.bar-row{margin:18px 0}.bar-label{display:flex;justify-content:space-between;gap:10px;margin-bottom:7px}.bar{height:11px;background:#edf1f6;border-radius:12px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--primary),var(--green))}.bar.good i{background:linear-gradient(90deg,#22a965,#53cc89)}.bar.mid i{background:linear-gradient(90deg,#e6a22d,#f2c760)}.bar.low i{background:linear-gradient(90deg,#df5a5a,#ee8585)}.pct-badge{padding:4px 8px;border-radius:999px;font-size:11px}.pct-badge.good{background:#e8f8ef;color:#16814a}.pct-badge.mid{background:#fff5dc;color:#9b6812}.pct-badge.low{background:#ffeded;color:#a23a3a}.performance-card{padding:14px;border:1px solid var(--line);border-radius:14px;background:#fbfcfe}.performance-card small{display:block;margin-top:8px;line-height:1.4}.student-number{display:inline-grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#edf4ff;color:var(--primary);font-size:11px;font-weight:800;margin-right:5px}.card-heading-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}.card-heading-row h2{margin:3px 0}.legend{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);flex-wrap:wrap}.legend i{width:8px;height:8px;border-radius:50%;display:inline-block;margin-left:5px}.legend-good{background:#34b874}.legend-mid{background:#e5aa37}.legend-low{background:#df6262}
    .school-result-group>summary{padding:19px}.school-average{display:flex;align-items:center;gap:12px}.school-average small,.class-average small{font-size:10px}.school-average b{font-size:23px;color:var(--primary)}.result-class-card{border:1px solid var(--line);border-radius:15px;overflow:hidden;background:#fbfcfe;margin:10px 0}.result-class-head{padding:12px;display:flex;justify-content:space-between;align-items:center}.result-class-head>div:first-child{display:flex;align-items:center;gap:9px}.result-class-head>div:first-child>div{display:flex;flex-direction:column}.class-average{text-align:right}.class-average b{display:block;color:var(--primary);font-size:19px}.result-exam-row{border-top:1px solid var(--line);padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:center;color:var(--ink);background:white}.result-exam-row:hover{background:#f7faff}.result-exam-row>div:first-child{display:flex;flex-direction:column;gap:4px}.result-exam-row>div:first-child b{font-size:13px}.result-exam-row>div:first-child small{font-size:10px}.result-numbers{display:flex;align-items:center;gap:15px}.result-numbers span{display:flex;flex-direction:column;text-align:right}.result-numbers span b{font-size:14px}.result-numbers span small{font-size:9px}.result-numbers i{font-style:normal;font-size:22px;color:#93a3b8}
    .empty-state{text-align:center;padding:35px}.empty-icon{font-size:40px}
    .recalc-soft{color:#765a15!important;background:#fff7e8!important;border-color:#efd89c!important}.legacy-recalc-page{max-width:980px}.legacy-recalc-card{background:white;border:1px solid var(--line);border-radius:24px;padding:24px;box-shadow:var(--shadow)}.legacy-recalc-icon{width:58px;height:58px;border-radius:17px;display:grid;place-items:center;background:#fff5dc;color:#8c6918;font-size:31px;margin-bottom:12px}.legacy-recalc-card h1{font-size:32px;margin:5px 0 8px}.legacy-recalc-lead{color:#59677d;line-height:1.55}.legacy-recalc-summary,.legacy-recalc-result{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:16px 0}.legacy-recalc-result{grid-template-columns:repeat(4,1fr);background:#f4faf7;border:1px solid #d8ebe2;border-radius:15px;padding:9px}.legacy-recalc-summary>div,.legacy-recalc-result>div{background:#f8fafc;border:1px solid #e5eaf1;border-radius:13px;padding:12px;display:flex;flex-direction:column;gap:3px}.legacy-recalc-summary span{font-size:20px}.legacy-recalc-summary small,.legacy-recalc-result small{font-size:8px;color:var(--muted);font-weight:900;text-transform:uppercase}.legacy-recalc-summary b,.legacy-recalc-result b{font-size:22px}.legacy-recalc-info{border-radius:13px;padding:12px 14px;background:#fff8e9;border:1px solid #efdca9;color:#6d571c;margin:10px 0}.legacy-recalc-info.soft{background:#f4f7fb;border-color:#e0e6ef;color:#526078}.legacy-recalc-info p{margin:4px 0 0;font-size:10px;line-height:1.5}.legacy-recalc-success{background:#eaf8f1;border:1px solid #c6e6d5;color:#276e58;padding:11px 13px;border-radius:12px;margin:12px 0}.legacy-recalc-warning{background:#fff0f0;border:1px solid #efc6ca;color:#923840;padding:11px 13px;border-radius:12px;margin:12px 0}.legacy-preview{margin:16px 0}.legacy-preview h2{margin:3px 0 9px}.legacy-recalc-form{display:grid;gap:10px;border-top:1px solid #e8ecf2;padding-top:16px}.recalc-button{background:linear-gradient(135deg,#9b7622,#c79a35)!important;color:white!important}.legacy-recalc-form .secondary{width:100%;text-align:center}
    .v23-exit-mini{display:inline-flex;width:max-content;margin-top:3px;padding:2px 5px;border-radius:999px;background:#fff0f0;color:#b34149;font-size:7px!important;font-style:normal;font-weight:850}.exit-result-pill{display:inline-flex;flex-direction:column;gap:2px;border-radius:10px;padding:6px 8px;font-size:10px}.exit-result-pill b{font-size:12px}.exit-result-pill small{font-size:8px}.exit-result-pill.clean{background:#edf8f3;color:#33745f}.exit-result-pill.with-exit{background:#fff0f0;color:#a33b43}
    .v22-students-section{border-top:1px solid #edf0f5;padding:11px 12px 13px;background:#fbfcfe}.v22-students-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.v22-students-title>div{display:flex;align-items:center;gap:8px}.v22-students-icon{width:32px;height:32px;border-radius:10px;background:#eaf3ff;display:grid;place-items:center}.v22-students-title>div>span:last-child{display:flex;flex-direction:column}.v22-students-title b{font-size:12px}.v22-students-title small{font-size:8px;color:var(--muted)}.v22-students-title>a{font-size:9px;font-weight:850;color:#315fbd}.v22-student-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.v22-student-card{display:grid;grid-template-columns:37px 1fr 58px;gap:8px;align-items:center;border:1px solid #e3e8ef;border-radius:13px;padding:8px 9px;background:white}.v22-student-avatar{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#edf4ff;color:#315fbd;font-size:10px;font-weight:950}.v22-student-name{min-width:0;display:flex;flex-direction:column}.v22-student-name b{font-size:10px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v22-student-name small{font-size:7px;color:var(--muted);margin-top:2px}.v22-student-grade{height:44px;border-radius:11px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}.v22-student-grade small{font-size:6px;font-weight:900;letter-spacing:.7px}.v22-student-grade b{font-size:18px;margin:2px 0}.v22-student-grade i{font-size:7px;font-style:normal}.v22-student-blue .v22-student-grade{background:#eaf3ff;color:#2c68c9}.v22-student-red .v22-student-grade{background:#ffeded;color:#c6555e}.rco-export-panel{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:14px 0;padding:16px 18px;background:linear-gradient(135deg,#f9fbff,#f4faf7);border-color:#dfe8ef}.rco-export-main{display:flex;align-items:center;gap:11px}.rco-export-icon{width:48px;height:48px;border-radius:14px;background:#eaf8f1;color:#31836b;display:grid;place-items:center;font-size:25px}.rco-export-main h2{margin:3px 0}.rco-export-main p{margin:0;font-size:10px;color:var(--muted);line-height:1.45}.rco-export-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}.rco-download-sheet{background:linear-gradient(135deg,#31836b,#4ca48d)!important}.rco-export-status{width:100%;font-size:9px;padding:7px 9px;border-radius:9px;display:none}.rco-export-status.ok{display:block;background:#eaf8f1;color:#26725c}.rco-export-status.warning{display:block;background:#fff7e8;color:#785d18}.rco-select-class,.rco-select-school{display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;flex:0 0 auto!important}.rco-select-class input,.rco-select-school input{position:absolute;opacity:0;pointer-events:none}.rco-select-class>span,.rco-select-school>span{width:27px;height:27px;border-radius:8px;border:1px solid rgba(115,132,157,.25);display:grid;place-items:center;background:#f2f5f9;color:transparent;font-size:11px;font-weight:950}.rco-select-class input:checked+span{background:#315fbd;color:white;border-color:#315fbd}.rco-select-school>span{background:rgba(255,255,255,.17);border-color:rgba(255,255,255,.4)}.rco-select-school input:checked+span{background:white;color:#315fbd;border-color:white}.rco-class-card>summary{gap:9px}.rco-school-card>summary{gap:9px}    .dashboard-v21{max-width:1240px}.v21-hero{background:linear-gradient(120deg,#315fbd 0%,#527bd6 56%,#4aa38b 130%);box-shadow:0 16px 38px rgba(47,95,174,.16)}.v21-primary-actions>a{border-color:#e4e9f1;box-shadow:0 5px 15px rgba(46,66,97,.045)}.v21-summary-strip .dash-summary-card{background:#fff;border-color:#e6eaf1}.v21-summary-strip .dash-summary-card.blue{background:linear-gradient(135deg,#f6f9ff,#edf4ff)}.v21-summary-strip .dash-summary-card.green{background:linear-gradient(135deg,#f4fbf8,#eaf8f1)}.v21-summary-strip .dash-summary-card.purple{background:linear-gradient(135deg,#faf8ff,#f2efff)}.v21-summary-strip .dash-summary-card.orange{background:linear-gradient(135deg,#fffaf5,#fff2e8)}.v21-tabs{background:#edf1f6}.v21-tabs .dash-tab.active{color:#315fbd!important}.v21-class-card{box-shadow:0 4px 13px rgba(43,61,89,.035)}.v21-trimester-grid{grid-template-columns:repeat(auto-fit,minmax(245px,1fr))!important}.v21-exam-numbers{grid-template-columns:1fr 1fr}.metric-good{color:#2c68c9!important}.metric-low{color:#c6555e!important}.v21-notes-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:4px 0 14px}.v21-notes-head h2{margin:4px 0 4px;font-size:27px}.v21-notes-head p{margin:0;color:var(--muted);font-size:11px}.v21-rco-button{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.v21-rco-button small{font-size:9px;color:var(--muted)}.class-performance-list{display:grid;gap:13px}.class-performance-card{background:white;border:1px solid #e4e9f1;border-radius:20px;overflow:hidden;box-shadow:0 7px 20px rgba(36,56,83,.05);border-left:5px solid #6b8fdc}.class-performance-card.class-accent-2{border-left-color:#806cd7}.class-performance-card.class-accent-3{border-left-color:#4da58c}.class-performance-card.class-accent-4{border-left-color:#d39a58}.class-performance-card.class-accent-5{border-left-color:#c97a94}.class-performance-card>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;cursor:pointer;background:linear-gradient(110deg,#fff,#f8fafc)}.class-performance-card>summary::-webkit-details-marker{display:none}.class-performance-main{display:flex;align-items:center;gap:10px;min-width:0}.class-performance-avatar{min-width:50px;height:50px;padding:0 8px;border-radius:14px;display:grid;place-items:center;background:#edf4ff;color:#315fbd;font-weight:950;font-size:16px}.class-performance-main h3{margin:1px 0;font-size:20px}.class-performance-main p{margin:1px 0 0;font-size:9px;color:var(--muted)}.class-performance-summary{display:flex;align-items:center;gap:20px}.class-performance-summary>span{display:flex;flex-direction:column;text-align:right}.class-performance-summary small{font-size:8px;color:var(--muted);font-weight:900;letter-spacing:.45px}.class-performance-summary b{font-size:18px;color:#2d3b50}.class-score-good{color:#2c68c9!important}.class-score-low{color:#c6555e!important}.class-performance-body{padding:0 12px 12px;background:#f8fafc}.class-exam-performance{background:#fff;border:1px solid #e5eaf1;border-radius:16px;margin-top:10px;overflow:hidden}.class-exam-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 13px;border-bottom:1px solid #edf0f5}.class-exam-head h4{margin:5px 0 0;font-size:15px}.trimester-soft-badge{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:5px 8px;font-size:8px;font-weight:900;letter-spacing:.25px;background:#edf4ff;color:#315fbd}.tri-soft-2{background:#f1edff;color:#7057c5}.tri-soft-3{background:#eaf8f1;color:#328069}.tri-soft-0{background:#f3f5f8;color:#66748a}.class-exam-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:11px 12px}.class-exam-metrics>div{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:12px;background:#f8fafc;border:1px solid #e8ecf2}.class-exam-metrics>div>span:last-child{display:flex;flex-direction:column}.class-exam-metrics small{font-size:7px;color:var(--muted);font-weight:900;letter-spacing:.45px}.class-exam-metrics b{font-size:16px;margin-top:2px}.metric-icon{width:31px;height:31px;border-radius:10px;display:grid;place-items:center;font-size:14px;flex:0 0 auto}.metric-blue{background:#eaf2ff;color:#315fbd}.metric-mint{background:#e9f8f2;color:#3b8a73}.metric-lilac{background:#f1edff;color:#755fc8}.topic-performance-section{border-top:1px solid #edf0f5;padding:11px 12px 12px}.topic-performance-title{display:flex;align-items:center;gap:8px;margin-bottom:9px}.topic-performance-title>span{width:31px;height:31px;border-radius:10px;background:#fff3e8;color:#c77f36;display:grid;place-items:center;font-size:15px}.topic-performance-title>div{display:flex;flex-direction:column}.topic-performance-title b{font-size:12px}.topic-performance-title small{font-size:8px;color:var(--muted)}.topic-performance-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.topic-performance{padding:9px 10px;border-radius:12px;border:1px solid #e5eaf1;background:#f7faff}.topic-performance.topic-palette-2{background:#f5fbf8}.topic-performance.topic-palette-3{background:#faf8ff}.topic-performance.topic-palette-4{background:#fff9f3}.topic-performance.topic-palette-5{background:#fff7fa}.topic-performance.topic-palette-6{background:#f4fafb}.topic-performance-head{display:grid;grid-template-columns:8px 1fr auto;gap:6px;align-items:center}.topic-dot{width:7px;height:7px;border-radius:50%;background:#5f82cf}.topic-palette-2 .topic-dot{background:#4aa38b}.topic-palette-3 .topic-dot{background:#806cd7}.topic-palette-4 .topic-dot{background:#d39a58}.topic-palette-5 .topic-dot{background:#c97a94}.topic-palette-6 .topic-dot{background:#5a9eb0}.topic-performance-head b{font-size:10px;line-height:1.2}.topic-performance-head strong{font-size:12px}.topic-score-good{color:#2c68c9}.topic-score-low{color:#c6555e}.topic-progress{height:5px;background:rgba(110,128,154,.13);border-radius:999px;overflow:hidden;margin:6px 0 4px}.topic-progress>span{display:block;height:100%;border-radius:999px;background:#6b8fdc}.topic-palette-2 .topic-progress>span{background:#62ae98}.topic-palette-3 .topic-progress>span{background:#8b77d9}.topic-palette-4 .topic-progress>span{background:#daa368}.topic-palette-5 .topic-progress>span{background:#d28ca3}.topic-palette-6 .topic-progress>span{background:#6aabbb}.topic-performance>small{display:block;font-size:7px;color:var(--muted)}    .batch-class-section{border:1px solid #d9e3f0;border-radius:17px;background:#f8fbff;padding:14px}.batch-class-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:10px}.batch-class-head>div:first-child{display:flex;flex-direction:column;gap:3px}.batch-class-head b{font-size:14px}.batch-class-head small{font-size:10px;color:var(--muted)}.batch-class-tools{display:flex;gap:5px;flex-wrap:wrap}.batch-class-grid{display:grid;grid-template-columns:repeat(9,1fr);gap:7px}.batch-class-card{position:relative;min-height:58px;border:1px solid var(--line);border-radius:12px;background:white;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;padding:7px}.batch-class-card input{position:absolute;opacity:0;pointer-events:none}.batch-class-card b{font-size:15px}.batch-class-check{width:21px;height:21px;border-radius:7px;border:1px solid #d7e0ec;background:#edf1f6;color:transparent;display:grid;place-items:center;font-size:11px;font-weight:950}.batch-class-card:has(input:checked),.batch-class-card.selected{background:#edf5ff;border-color:#8fb7f4;box-shadow:0 0 0 1px rgba(35,103,242,.08)}.batch-class-card:has(input:checked) .batch-class-check,.batch-class-card.selected .batch-class-check{background:#2367f2;border-color:#2367f2;color:white}.batch-class-status{margin-top:9px;border-radius:10px;padding:8px 10px;font-size:10px}.batch-class-status.warning{background:#fff7e8;border:1px solid #efd89c;color:#755b17}.batch-class-status.ok{background:#eaf8f1;border:1px solid #c5e6d4;color:#176d49}.batch-custom-class{display:block;margin-top:10px}.batch-custom-class small{display:block;margin-top:4px;color:var(--muted)}.batch-result-page{max-width:1180px}.batch-result-hero{background:linear-gradient(120deg,#173d7e,#2367f2 56%,#20aa77 135%);border-radius:27px;padding:27px 29px;color:white;display:flex;justify-content:space-between;align-items:center;gap:18px;box-shadow:0 18px 42px rgba(35,103,242,.18)}.batch-result-hero h1{font-size:clamp(29px,5vw,44px);margin:4px 0 6px}.batch-result-hero p{margin:0;color:rgba(255,255,255,.82)}.batch-copy-all{display:grid;grid-template-columns:1fr minmax(260px,1.2fr) auto;gap:13px;align-items:center;margin:14px 0}.batch-copy-all h2{margin:3px 0}.batch-copy-all p{margin:0;color:var(--muted);font-size:10px}.batch-copy-all textarea{min-height:74px;resize:vertical;font-size:11px}.batch-difference-note{display:flex;gap:11px;align-items:flex-start;background:#edf5ff;border:1px solid #cfe0fb;color:#24568f;border-radius:15px;padding:12px 14px;margin-bottom:13px}.batch-difference-note>span{font-size:24px}.batch-difference-note b{font-size:12px}.batch-difference-note p{margin:3px 0 0;font-size:10px;line-height:1.5}.batch-created-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.batch-created-card{background:white;border:1px solid var(--line);border-radius:20px;padding:15px;box-shadow:0 7px 20px rgba(24,48,82,.055)}.batch-created-top{display:grid;grid-template-columns:38px 1fr auto;gap:9px;align-items:center}.batch-created-number{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#edf4ff;color:#2367f2;font-weight:950}.batch-created-top h2{margin:0;font-size:21px}.batch-created-top p{margin:2px 0 0;font-size:9px;color:var(--muted)}.batch-created-ok{font-size:8px;font-weight:900;color:#18855c;background:#e8f8ef;padding:5px 7px;border-radius:999px}.batch-created-info{display:grid;grid-template-columns:1fr 1fr;margin:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.batch-created-info>span{display:flex;flex-direction:column;align-items:center;padding:9px}.batch-created-info>span+span{border-left:1px solid var(--line)}.batch-created-info b{font-size:18px}.batch-created-info small{font-size:8px;color:var(--muted)}.batch-created-share{display:grid;grid-template-columns:1fr 180px;gap:12px;align-items:center}.batch-created-link label{font-size:9px;text-transform:uppercase;color:var(--muted);font-weight:900}.batch-created-link>div:nth-child(2){display:grid;grid-template-columns:1fr auto;gap:5px;margin-top:4px}.batch-created-link input{font-size:10px}.batch-created-link button{min-height:0;padding:9px 10px}.batch-created-actions{display:flex;gap:5px;margin-top:7px}.batch-created-qr{text-align:center;background:#f8fbff;border:1px solid var(--line);border-radius:13px;padding:8px}.batch-created-qr img{display:block;width:100%;height:auto;background:white;border-radius:8px}.batch-created-qr small{font-size:8px;color:var(--muted)}.batch-result-footer{display:flex;justify-content:center;gap:8px;margin:16px 0 5px}
    .create-exam-v18{max-width:1180px}.create-hero-v18 h1{margin:5px 0}.compact-heading{margin:0 0 12px}.compact-heading h2{margin:3px 0 4px}.compact-heading p{margin:0;color:var(--muted);font-size:11px}.topic-multi-tools{display:flex;gap:6px;flex-wrap:wrap}.topic-status-warning{background:#fff7e8!important;border-color:#efd89c!important;color:#755b17!important}.topic-status-ok{background:#eaf8f1!important;border-color:#c5e6d4!important;color:#176d49!important}.topic-limit-disabled{opacity:.38;cursor:not-allowed!important;filter:grayscale(.15)}.topic-limit-disabled:hover{background:white!important;border-color:var(--line)!important}.topic-multi-status{padding:10px 12px;border-radius:12px;background:#f4f7fb;border:1px solid var(--line);font-size:11px;color:#59677d;margin-bottom:11px}.topic-multi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:390px;overflow:auto;padding:2px}.topic-multi-card{position:relative;display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:13px;padding:10px 11px;background:white;cursor:pointer;transition:.15s}.topic-multi-card:hover{border-color:#b8cbec;background:#f9fbff}.topic-multi-card input{position:absolute;opacity:0;pointer-events:none}.topic-check{width:27px;height:27px;border-radius:8px;display:grid;place-items:center;background:#edf1f6;color:transparent;border:1px solid #d8e0eb;flex:0 0 auto;font-weight:950}.topic-multi-card:has(input:checked){border-color:#9bbcf3;background:#f3f7ff;box-shadow:0 0 0 1px rgba(35,103,242,.06)}.topic-multi-card:has(input:checked) .topic-check{background:#2367f2;color:white;border-color:#2367f2}.topic-multi-copy{display:flex;flex-direction:column;min-width:0;gap:2px}.topic-multi-copy b{font-size:11px;line-height:1.2}.topic-multi-copy small{font-size:8px;color:var(--muted)}.manual-ajax-list{max-height:560px;overflow:auto}.manual-loading{padding:28px;text-align:center;color:var(--muted);border:1px dashed #ccd6e4;border-radius:13px}.v18-info-box{line-height:1.55}
    .bank-question-cell{min-width:300px}.bank-image-tag{display:inline-flex;margin-top:6px;padding:4px 7px;border-radius:999px;background:#eaf3ff;color:#1764d8;font-weight:800}.bank-image-cell{min-width:96px}.bank-image-link{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:9px;font-weight:850}.bank-thumb{width:76px;height:52px;object-fit:cover;border-radius:9px;border:1px solid var(--line);background:#eef2f6}.bank-add-image{display:inline-flex;align-items:center;justify-content:center;padding:7px 9px;border-radius:9px;background:#edf4ff;color:#1764d8;font-size:10px;font-weight:850;white-space:nowrap}.bank-new-image-box{border:1px dashed #bfcce0;border-radius:16px;padding:15px;background:#f8fbff;display:grid;gap:10px}.bank-new-image-box>div:first-child{display:flex;flex-direction:column;gap:4px}.bank-new-image-box>div:first-child>b{font-size:14px}.bank-new-image-box>div:first-child>small{font-size:10px;color:var(--muted)}.bank-image-upload{border:1px solid #cfe0fb;background:white;border-radius:12px;padding:12px;cursor:pointer;text-align:center;color:#1764d8;font-weight:850}.bank-image-upload input{margin-top:8px}.bank-new-image-preview{max-width:430px;border:1px solid var(--line);border-radius:13px;overflow:hidden;background:white}.bank-new-image-preview img{display:block;width:100%;max-height:270px;object-fit:contain}.question-image-page{max-width:1120px}.question-image-success{background:#e7f8ef;color:#177d50;border:1px solid #c1e7d0;padding:11px 14px;border-radius:12px;margin:12px 0}.question-image-editor-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}.question-image-current{margin-top:14px}.question-image-current>img{display:block;width:100%;max-height:480px;object-fit:contain;border:1px solid var(--line);border-radius:15px;background:#eef2f7}.question-image-current>div:not(.question-image-placeholder){padding-top:9px;display:flex;flex-direction:column;gap:3px}.question-image-current small{color:var(--muted)}.question-image-current p{margin:4px 0;color:#57667c}.question-image-placeholder{min-height:280px;border:2px dashed #cbd5e3;border-radius:15px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;color:#738197;background:#f8fafc}.question-image-placeholder>span{font-size:46px}.question-image-form{display:grid;gap:12px;margin-top:14px}.question-image-drop{border:2px dashed #b9c9df;border-radius:15px;background:#f8fbff;min-height:150px;padding:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:5px;cursor:pointer}.question-image-drop>span{font-size:34px}.question-image-drop>small{color:var(--muted)}.question-image-drop input{margin-top:8px}.question-image-preview{border:1px solid var(--line);border-radius:13px;overflow:hidden}.question-image-preview img{display:block;width:100%;max-height:280px;object-fit:contain;background:#eef2f7}.question-image-remove{margin-top:12px}.manual-question-thumb{width:88px;height:65px;object-fit:cover;border-radius:9px;border:1px solid var(--line);flex:0 0 auto;margin-left:6px}.manual-image-badge{display:inline-flex;margin-left:6px;padding:2px 5px;background:#eaf3ff;color:#1764d8;border-radius:999px;font-size:8px!important}.exam-question-list-item{display:flex;gap:10px;align-items:flex-start;margin:9px 0}.exam-question-list-item>img{width:94px;height:65px;object-fit:cover;border-radius:9px;border:1px solid var(--line);flex:0 0 auto}
    .dashboard-v16{max-width:1240px}.dashboard-toast-success{position:sticky;top:82px;z-index:45;margin:0 auto 12px;max-width:520px;background:#e8f8ef;border:1px solid #bfe8cf;color:#167a4d;border-radius:13px;padding:11px 14px;text-align:center;font-weight:850;box-shadow:var(--shadow)}.dash-hero{background:linear-gradient(120deg,#193c7b,#2367f2 58%,#24a879 135%);color:white;border-radius:27px;padding:27px 29px;display:flex;align-items:center;justify-content:space-between;gap:20px;box-shadow:0 18px 42px rgba(35,103,242,.2)}.dash-hero h1{font-size:clamp(29px,5vw,45px);margin:5px 0 5px;letter-spacing:-1.2px}.dash-hero p{margin:0;color:rgba(255,255,255,.82)}.dash-hero-actions{display:flex;gap:8px;flex-wrap:wrap}.dash-primary-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin:14px 0}.dash-primary-actions>a{background:white;border:1px solid var(--line);border-radius:16px;padding:13px 14px;display:flex;align-items:center;gap:10px;color:var(--ink);box-shadow:0 5px 16px rgba(24,48,82,.05)}.dash-primary-actions>a>span{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:#edf4ff;color:var(--primary);font-size:20px}.dash-primary-actions>a:nth-child(2)>span{background:#e9f9f2;color:#18855c}.dash-primary-actions>a:nth-child(3)>span{background:#f1edff;color:#7459df}.dash-primary-actions>a:nth-child(4)>span{background:#fff1e5;color:#d77929}.dash-primary-actions>a>div{display:flex;flex-direction:column;gap:2px}.dash-primary-actions b{font-size:13px}.dash-primary-actions small{font-size:10px}.dash-summary-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 16px}.dash-summary-card{background:white;border:1px solid var(--line);border-radius:17px;padding:13px 14px;display:grid;grid-template-columns:35px 1fr;align-items:center;box-shadow:0 5px 16px rgba(24,48,82,.045)}.dash-summary-card>span{grid-row:1/3;font-size:23px}.dash-summary-card>b{font-size:24px;line-height:1}.dash-summary-card>small{font-size:9px;text-transform:uppercase;letter-spacing:.4px}.dash-summary-card.blue b{color:#2367f2}.dash-summary-card.green b{color:#18855c}.dash-summary-card.purple b{color:#7459df}.dash-summary-card.orange b{color:#d77929}.dash-tabs{display:flex;gap:8px;padding:5px;background:#e9eef6;border-radius:15px;margin:0 0 16px}.dash-tab{flex:1;background:transparent!important;color:#65738a!important;box-shadow:none!important;border:0!important;border-radius:11px!important;padding:11px!important}.dash-tab.active{background:white!important;color:var(--primary)!important;box-shadow:0 3px 10px rgba(24,48,82,.08)!important}.dash-tab-panel{display:none}.dash-tab-panel.active{display:block}.dash-section-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin:0 0 13px}.dash-section-head h2{margin:4px 0 4px;font-size:25px}.dash-section-head p{margin:0;color:var(--muted);max-width:680px;font-size:12px;line-height:1.5}.dash-search{min-width:320px}.dash-school{background:white;border:1px solid var(--line);border-radius:21px;overflow:hidden;margin-bottom:13px;box-shadow:0 7px 20px rgba(24,48,82,.05)}.dash-school>summary{list-style:none;cursor:pointer;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;color:white}.dash-school>summary::-webkit-details-marker{display:none}.school-color-1>summary{background:linear-gradient(105deg,#2465dc,#4a8cff)}.school-color-2>summary{background:linear-gradient(105deg,#684fd2,#9477e9)}.school-color-3>summary{background:linear-gradient(105deg,#178b68,#35b887)}.school-color-4>summary{background:linear-gradient(105deg,#c66d27,#ee9c45)}.school-color-5>summary{background:linear-gradient(105deg,#30455f,#5a718e)}.dash-school-main{display:flex;align-items:center;gap:11px}.dash-school-icon{width:44px;height:44px;border-radius:13px;background:rgba(255,255,255,.15);display:grid;place-items:center;font-size:23px}.dash-school-main .eyebrow{color:rgba(255,255,255,.72)}.dash-school-main h2{margin:1px 0;font-size:20px}.dash-school-main p{margin:1px 0 0;font-size:10px;opacity:.8}.dash-school-content{padding:12px;background:#f8fafd}.dash-shift{margin:0 0 12px}.dash-shift:last-child{margin-bottom:0}.dash-shift-title{display:flex;align-items:center;gap:8px;padding:3px 2px 8px}.dash-shift-title h3{font-size:16px;margin:0}.dash-class-card{border:1px solid var(--line);background:white;border-radius:16px;overflow:hidden;margin-bottom:9px}.dash-class-card>summary{list-style:none;cursor:pointer;padding:11px 13px;display:flex;align-items:center;justify-content:space-between}.dash-class-card>summary::-webkit-details-marker{display:none}.dash-class-summary{display:flex;align-items:center;gap:9px}.dash-class-avatar{min-width:45px;height:45px;padding:0 7px;border-radius:12px;display:grid;place-items:center;background:#edf4ff;color:#2367f2;font-weight:950}.dash-class-summary h3{margin:0;font-size:18px}.dash-class-summary p{margin:2px 0 0;color:var(--muted);font-size:9px}.dash-trimester-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 10px 10px}.dash-trimester{border:1px solid var(--line);border-radius:14px;background:#fbfcfe;overflow:hidden;min-width:0}.dash-trimester.tri-0{grid-column:1/-1}.dash-trimester.tri-1{border-top:3px solid #2367f2}.dash-trimester.tri-2{border-top:3px solid #7459df}.dash-trimester.tri-3{border-top:3px solid #20ae68}.dash-trimester-head{display:flex;align-items:center;gap:7px;padding:9px 10px;border-bottom:1px solid var(--line);background:white}.dash-trimester-head>span{font-size:20px}.dash-trimester-head>div{display:flex;flex-direction:column}.dash-trimester-head b{font-size:11px}.dash-trimester-head small{font-size:8px}.dash-trimester-body{padding:7px;display:grid;gap:7px}.dash-exam-card{background:white;border:1px solid var(--line);border-radius:12px;padding:10px;min-width:0;box-shadow:0 3px 10px rgba(24,48,82,.035)}.dash-exam-top{display:flex;align-items:center;justify-content:space-between}.dash-exam-top>div{display:flex;align-items:center;gap:5px}.dash-exam-top small{font-size:7px;font-weight:900;letter-spacing:.5px}.status-dot{width:7px;height:7px;border-radius:50%}.status-dot.is-open{background:#20ae68;box-shadow:0 0 0 3px rgba(32,174,104,.1)}.status-dot.is-closed{background:#9ba7b8}.dash-exam-id{font-size:8px;color:#9aa6b6}.dash-exam-card h4{margin:7px 0 2px;font-size:13px;line-height:1.25}.dash-exam-card>p{margin:0 0 7px;font-size:9px;color:var(--muted)}.dash-exam-numbers{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #edf1f6;border-bottom:1px solid #edf1f6;margin:7px 0}.dash-exam-numbers>span{padding:7px 2px;display:flex;flex-direction:column;align-items:center}.dash-exam-numbers>span+span{border-left:1px solid #edf1f6}.dash-exam-numbers b{font-size:15px}.dash-exam-numbers small{font-size:7px;text-transform:uppercase}.dash-exam-actions{display:grid;grid-template-columns:1fr 1fr auto auto;gap:4px}.dash-exam-actions form{margin:0}.dash-action{min-height:30px!important;padding:6px 7px!important;border-radius:8px!important;background:#f1f5fb!important;color:#43516a!important;border:1px solid #dfe6ef!important;box-shadow:none!important;font-size:9px!important;font-weight:850!important;width:100%!important}.dash-action.primary{background:#eaf2ff!important;color:#2367f2!important;border-color:#cfe0fb!important}.dash-action.link-action{width:31px!important}.dash-action.delete-action{width:31px!important;background:#ffeded!important;color:#c93636!important;border-color:#ffd3d3!important}.dash-action.copied{background:#e8f8ef!important;color:#18855c!important}.dash-no-exam{min-height:91px;border:1px dashed #dce4ef;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#a1acbb}.dash-no-exam span{font-size:18px}.dash-no-exam small{font-size:8px}.dash-tools{margin-top:13px;display:flex;align-items:center;justify-content:space-between;gap:15px;padding:13px 15px}.dash-tools>div:first-child{display:flex;flex-direction:column;gap:2px}.dash-tools>div:last-child{display:flex;gap:6px;flex-wrap:wrap}.dash-tools b{font-size:12px}.dash-tools small{font-size:9px}.danger-soft{color:#b53232!important;background:#fff3f3!important;border-color:#ffd3d3!important}.dash-notes-top{display:grid;grid-template-columns:230px 1fr;gap:12px;margin-bottom:12px}.dash-general-average{background:linear-gradient(135deg,#153b79,#2367f2);color:white;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:150px;box-shadow:0 10px 28px rgba(35,103,242,.17)}.dash-general-average small{color:rgba(255,255,255,.72);font-size:9px;font-weight:900;letter-spacing:1px}.dash-general-average b{font-size:58px;line-height:.95;margin:6px 0}.dash-general-average span{font-size:10px;opacity:.75}.dash-rco-callout{margin:0;display:grid;grid-template-columns:52px 1fr auto;gap:12px;align-items:center}.rco-callout-icon{width:48px;height:48px;border-radius:14px;background:#e9f9f2;color:#18855c;display:grid;place-items:center;font-size:25px}.dash-rco-callout h3{margin:2px 0 3px}.dash-rco-callout p{margin:0;color:var(--muted);font-size:11px}.dash-average-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dash-average-panel{margin:0}.dash-average-panel.wide{grid-column:1/-1}.dash-average-title{display:flex;align-items:center;gap:9px;margin-bottom:10px}.dash-average-title>span{width:38px;height:38px;border-radius:11px;background:#f1f5fb;display:grid;place-items:center}.dash-average-title>div{display:flex;flex-direction:column}.dash-average-title b{font-size:13px}.dash-average-title small{font-size:9px}.dash-mean-list{display:grid;gap:6px}.dash-mean-list.scroll{grid-template-columns:repeat(2,1fr);max-height:330px;overflow:auto}.dash-mean-card{display:grid;grid-template-columns:32px 1fr auto;gap:8px;align-items:center;padding:9px;border-radius:11px;background:#f8fafd;border:1px solid var(--line)}.dash-mean-icon{font-size:17px}.dash-mean-copy{display:flex;flex-direction:column;min-width:0}.dash-mean-copy b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dash-mean-copy small{font-size:8px}.dash-mean-card strong{font-size:17px}.dash-note-good strong{color:#1764d8}.dash-note-low strong{color:#c93636}.dash-students-panel{margin-top:12px!important}.delete-exam-button{background:#c93636!important;color:white!important;box-shadow:none!important}.copy-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,25px);opacity:0;pointer-events:none;background:#173c31;color:white;padding:11px 16px;border-radius:999px;font-size:12px;font-weight:850;box-shadow:var(--shadow2);transition:.2s;z-index:9999}.copy-toast.show{opacity:1;transform:translate(-50%,0)}
    .quick-icon.teal{background:#e6fbf6;color:#11977d}.rco-quick-card{border-color:#ccefe7}.rco-page{max-width:1320px}.rco-hero{background:linear-gradient(125deg,#13233d 0%,#1f5fc9 55%,#20a77a 125%);border-radius:28px;padding:28px 30px;color:white;display:flex;justify-content:space-between;align-items:center;gap:22px;box-shadow:var(--shadow2);position:relative;overflow:hidden}.rco-hero:after{content:"";position:absolute;width:260px;height:260px;border-radius:50%;right:-90px;top:-110px;background:rgba(255,255,255,.08)}.rco-hero h1{font-size:clamp(30px,5vw,48px);margin:5px 0 7px;letter-spacing:-1.3px}.rco-hero p{margin:0;opacity:.86;max-width:700px}.rco-hero-actions{display:flex;gap:8px;position:relative;z-index:2}.rco-help-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.rco-help-strip>div{background:white;border:1px solid var(--line);border-radius:16px;padding:12px 14px;display:grid;grid-template-columns:36px 1fr;column-gap:8px;align-items:center;box-shadow:0 5px 16px rgba(24,48,82,.04)}.rco-help-strip>div>span{grid-row:1/3;font-size:24px}.rco-help-strip b{font-size:13px}.rco-help-strip small{font-size:10px;color:var(--muted)}.rco-toolbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 0 18px}.rco-toolbar h2{margin:3px 0 0}.rco-search{min-width:330px}.rco-school-card{background:white;border:1px solid var(--line);border-radius:24px;overflow:hidden;margin:0 0 18px;box-shadow:var(--shadow)}.rco-school-card>summary{list-style:none;padding:20px 22px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;color:white}.rco-school-card>summary::-webkit-details-marker{display:none}.school-theme-1>summary{background:linear-gradient(110deg,#2367f2,#4a8cff)}.school-theme-2>summary{background:linear-gradient(110deg,#7459df,#9c80ef)}.school-theme-3>summary{background:linear-gradient(110deg,#159a72,#36bd8e)}.school-theme-4>summary{background:linear-gradient(110deg,#d9782d,#f0a24d)}.school-theme-5>summary{background:linear-gradient(110deg,#344a67,#59718f)}.rco-school-main{display:flex;align-items:center;gap:13px;min-width:0}.rco-school-main .eyebrow{color:rgba(255,255,255,.78)}.rco-school-main h2{margin:2px 0;font-size:23px}.rco-school-main p{margin:0;font-size:11px;opacity:.82}.rco-school-icon{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;background:rgba(255,255,255,.16);font-size:25px}.rco-school-content{padding:17px;background:#f8fafd}.rco-shift-block{margin-bottom:16px}.rco-shift-block:last-child{margin-bottom:0}.rco-shift-head{display:flex;align-items:center;gap:9px;padding:2px 2px 10px}.rco-shift-icon{width:38px;height:38px;border-radius:11px;background:white;border:1px solid var(--line);display:grid;place-items:center}.rco-shift-head h3{margin:1px 0;font-size:18px}.rco-class-card{background:white;border:1px solid var(--line);border-radius:19px;overflow:hidden;margin:0 0 12px}.rco-class-card>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#fff}.rco-class-card>summary::-webkit-details-marker{display:none}.rco-class-left{display:flex;align-items:center;gap:11px}.rco-class-badge{min-width:48px;height:48px;padding:0 8px;border-radius:14px;background:linear-gradient(135deg,#edf4ff,#e9f9f2);color:var(--primary);display:grid;place-items:center;font-weight:950}.rco-class-left h3{margin:0;font-size:20px}.rco-class-left p{margin:2px 0 0;font-size:10px;color:var(--muted)}.rco-class-content{padding:0 13px 13px}.rco-trimester{border:1px solid var(--line);border-radius:17px;margin:0 0 12px;overflow:hidden;background:white}.rco-trimester:last-child{margin-bottom:0}.rco-trimester.tri-1{border-top:4px solid #2367f2}.rco-trimester.tri-2{border-top:4px solid #7459df}.rco-trimester.tri-3{border-top:4px solid #20ae68}.rco-tri-head{padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fbfcfe}.rco-tri-head>div:first-child{display:flex;align-items:center;gap:9px}.rco-tri-number{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;font-size:23px;font-weight:900}.tri-1 .rco-tri-number{background:#eaf3ff;color:#2367f2}.tri-2 .rco-tri-number{background:#f1edff;color:#7459df}.tri-3 .rco-tri-number{background:#eaf9f1;color:#159a72}.rco-tri-head h4{margin:0;font-size:16px}.rco-tri-head p{margin:2px 0 0;font-size:10px;color:var(--muted)}.rco-tri-head small{font-size:8px;color:var(--muted);font-weight:900;letter-spacing:1px}.rco-main-copy{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.rco-copy-primary{background:#1c73dd!important}.rco-exam-copy-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 14px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fff}.rco-exam-copy-row>span{font-size:10px;color:var(--muted);font-weight:800;margin-right:3px}.rco-copy-chip{width:auto!important;min-height:0!important;padding:6px 9px!important;background:#f1f5fb!important;color:#42516a!important;box-shadow:none!important;border:1px solid #dce4ef!important;border-radius:999px!important;font-size:10px!important}.rco-copy-chip:hover{background:#e9f1ff!important;color:#2367f2!important}.rco-copy-chip.copied,.rco-main-copy .copied{background:#e7f8ef!important;color:#168252!important;border-color:#bce6cf!important}.copy-source{position:fixed!important;left:-10000px!important;top:-10000px!important;width:1px!important;height:1px!important;opacity:0!important}.rco-table-wrap{overflow:auto;max-height:560px}.rco-table{width:100%;border-collapse:separate;border-spacing:0;min-width:660px}.rco-table th{position:sticky;top:0;z-index:2;background:#f5f8fc;color:#536176;font-size:10px;text-transform:uppercase;letter-spacing:.4px;padding:10px;border-bottom:1px solid var(--line);white-space:nowrap}.rco-table th span{display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;text-transform:none;color:var(--ink);font-size:11px}.rco-table th small{display:block;font-size:8px;margin-top:2px}.rco-table td{padding:9px 10px;border-bottom:1px solid #edf1f6;background:white;text-align:center}.rco-table tbody tr:hover td{background:#fafcff}.rco-table td.rco-student-name{text-align:left;font-weight:800;white-space:nowrap;position:sticky;left:42px;z-index:1}.rco-table th:nth-child(2){position:sticky;left:42px;z-index:4}.rco-student-number{width:42px;color:#99a4b5;font-size:11px;position:sticky;left:0;z-index:2}.rco-table th:first-child{left:0;z-index:5}.rco-note{display:inline-flex;min-width:48px;justify-content:center;padding:6px 8px;border-radius:10px;font-weight:950;font-size:14px}.rco-note-blue{background:#eaf3ff;color:#1764d8}.rco-note-red{background:#ffeded;color:#c93636}.rco-average-head{background:#edf7f3!important;color:#177858!important}.rco-average-cell{background:#fbfefa!important}.rco-average-note{min-width:54px}.rco-missing{color:#b6bfcc}.rco-no-data{font-size:10px;color:#9aa5b5;background:#f1f4f8;border-radius:999px;padding:6px 9px}.rco-empty-tri{opacity:.78}.copy-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,25px);opacity:0;pointer-events:none;background:#173c31;color:white;padding:11px 16px;border-radius:999px;font-size:12px;font-weight:850;box-shadow:var(--shadow2);transition:.2s;z-index:9999}.copy-toast.show{opacity:1;transform:translate(-50%,0)}
    .student-grades-panel{margin:0 0 28px;padding:0;overflow:hidden}.student-grades-head{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:20px 20px 14px}.student-grades-head h2{margin:4px 0 3px;font-size:25px}.student-grades-head p{margin:0;color:var(--muted);font-size:13px}.student-grade-search{display:flex;align-items:center;gap:8px;min-width:300px;background:#f7f9fc;border:1px solid var(--line);border-radius:12px;padding:0 10px}.student-grade-search input{border:0;background:transparent;box-shadow:none;padding:11px 4px}.student-grade-legend{display:flex;align-items:center;gap:15px;padding:10px 20px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fbfcfe;font-size:11px;color:var(--muted)}.student-grade-legend span{display:flex;align-items:center;gap:5px}.student-grade-legend a{margin-left:auto;font-weight:800}.legend-note-blue,.legend-note-red{display:inline-block;width:9px;height:9px;border-radius:50%}.legend-note-blue{background:#2367f2}.legend-note-red{background:#d84848}.student-grade-list{max-height:520px;overflow:auto}.student-grade-row{display:grid;grid-template-columns:48px 1fr 82px;gap:12px;align-items:center;padding:13px 20px;border-bottom:1px solid var(--line);color:var(--ink);transition:.15s}.student-grade-row:hover{background:#f7faff}.student-grade-avatar{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:#edf4ff;color:var(--primary);font-size:12px;font-weight:900}.student-grade-info{min-width:0;display:flex;flex-direction:column;gap:2px}.student-grade-info>b{font-size:15px}.student-grade-info small{font-size:11px;color:#68758c}.student-grade-info small strong{color:var(--ink)}.student-grade-info em{font-style:normal;font-size:11px;color:var(--primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.student-note{height:58px;border-radius:15px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}.student-note small{font-size:8px;font-weight:900;letter-spacing:1px;color:inherit}.student-note b{font-size:25px;margin:3px 0}.student-note i{font-style:normal;font-size:9px;font-weight:800;opacity:.75}.student-note-blue{background:#eaf3ff;color:#1764d8}.student-note-red{background:#ffeded;color:#c93636}.student-grade-empty{padding:34px 20px;text-align:center;display:flex;flex-direction:column;gap:5px}.student-grade-empty>span{font-size:34px}.result-student-cell{display:flex;align-items:center;gap:7px;white-space:nowrap}.class-table-chip{display:inline-flex;padding:6px 9px;border-radius:999px;background:#f1f4f8;color:#42516a;font-weight:850;font-size:12px}.table-note{display:inline-flex;align-items:baseline;gap:2px;min-width:72px;justify-content:center;border-radius:10px;padding:7px 9px;font-size:18px;font-weight:950}.table-note small{font-size:9px;color:inherit}.table-note-blue{background:#eaf3ff;color:#1764d8}.table-note-red{background:#ffeded;color:#c93636}
    .dashboard-means{display:grid;grid-template-columns:.8fr 1.2fr;gap:16px;margin:18px 0 28px}.mean-panel{margin:0}.mean-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}.mean-panel-head h2{margin:3px 0}.mean-scale{font-size:11px;font-weight:900;color:var(--muted);background:#f1f4f8;border-radius:999px;padding:6px 9px}.mean-list{display:grid;gap:8px}.mean-scroll{max-height:330px;overflow:auto;padding-right:4px}.mean-row{display:flex;justify-content:space-between;gap:13px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:12px;background:#fbfcfe}.mean-row strong{font-size:23px;min-width:52px;text-align:right}.mean-label{display:flex;flex-direction:column;gap:2px}.mean-label small{font-size:10px;color:var(--muted)}.mean-good strong{color:#1764d8}.mean-low strong{color:#c93636}.muted{color:var(--muted)}.result-shift-title{display:flex;align-items:center}.shift-average{margin-left:auto;text-align:right;display:flex;flex-direction:column}.shift-average small{font-size:9px;color:var(--muted)}.shift-average b{font-size:21px;color:var(--primary)}.cleanup-bank-card{border-color:#ffd3d3;background:linear-gradient(135deg,#fff,#fff8f8)}.cleanup-bank-main{display:flex;justify-content:space-between;gap:18px;align-items:center}.cleanup-bank-main h2{margin:4px 0 7px}.danger-link{background:#c93636!important;color:white!important}.share-exam-card{display:grid;grid-template-columns:1fr 250px;gap:24px;align-items:center}.share-exam-copy h2{margin:4px 0 13px}.short-link-box{display:grid;grid-template-columns:1fr auto;gap:8px}.short-link-box button{white-space:nowrap}.qr-box{background:#f8fbff;border:1px solid var(--line);border-radius:18px;padding:14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px}.qr-box img{max-width:100%;height:auto;border-radius:10px;background:white}.qr-box small{font-size:10px;color:var(--muted);line-height:1.35}
    .count-picker{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0 14px}.count-picker>span{font-size:12px;font-weight:850;color:var(--muted);margin-right:3px}.count-chip{width:auto!important;min-width:42px!important;padding:9px 12px!important;border-radius:999px!important;background:#f4f7fb!important;color:#40506a!important;border:1px solid var(--line)!important;box-shadow:none!important;font-size:13px!important}.count-chip.active,.count-chip:hover{background:#eaf2ff!important;color:var(--primary)!important;border-color:#a9c7f7!important;transform:none!important}
    @media(max-width:900px){.rco-export-panel{align-items:flex-start;flex-direction:column}.rco-export-actions{justify-content:flex-start}.v22-student-grid{grid-template-columns:1fr}.v21-notes-head{align-items:flex-start;flex-direction:column}.v21-rco-button{align-items:flex-start}.topic-performance-grid{grid-template-columns:1fr}.class-performance-summary{gap:10px}.class-exam-metrics{grid-template-columns:1fr}.batch-class-grid{grid-template-columns:repeat(5,1fr)}.batch-created-grid{grid-template-columns:1fr}.batch-copy-all{grid-template-columns:1fr}.batch-result-hero{align-items:flex-start;flex-direction:column}.topic-multi-grid{grid-template-columns:1fr 1fr}.question-image-editor-grid{grid-template-columns:1fr}.dash-primary-actions{grid-template-columns:1fr 1fr}.dash-trimester-grid{grid-template-columns:1fr}.dash-notes-top{grid-template-columns:1fr}.dash-average-grid{grid-template-columns:1fr}.dash-average-panel.wide{grid-column:auto}.dash-mean-list.scroll{grid-template-columns:1fr}.dash-hero{align-items:flex-start;flex-direction:column}.rco-help-strip{grid-template-columns:1fr 1fr}.rco-hero{align-items:flex-start;flex-direction:column}.rco-toolbar{align-items:flex-start;flex-direction:column}.rco-search{min-width:0;width:100%}.dashboard-means{grid-template-columns:1fr}.share-exam-card{grid-template-columns:1fr}.qr-box{max-width:300px}.quick-actions{grid-template-columns:1fr 1fr}.nav-txt{display:none}.navlinks a,.navlinks .install-app-link{padding:9px 10px}.nav-ico{font-size:22px}.navlinks .logout-link{padding:8px 10px;border-radius:12px}.navlinks .install-app-link{padding:8px 10px}.welcome-mark{width:105px;height:105px}.exam-grid{grid-template-columns:1fr}}
    @media(max-width:760px){.dash-section-head{align-items:flex-start;flex-direction:column}.dash-search{min-width:0;width:100%}.dash-summary-strip{grid-template-columns:1fr 1fr}.dash-rco-callout{grid-template-columns:45px 1fr}.dash-rco-callout>.btn{grid-column:1/-1}.dash-tools{align-items:flex-start;flex-direction:column}.dash-exam-actions{grid-template-columns:1fr 1fr auto auto}.rco-school-content{padding:10px}.rco-tri-head{align-items:flex-start;flex-direction:column}.rco-main-copy{justify-content:flex-start}.rco-hero-actions{flex-wrap:wrap}.rco-table td.rco-student-name,.rco-table th:nth-child(2){position:static}.rco-student-number,.rco-table th:first-child{position:static}.rco-help-strip{grid-template-columns:1fr 1fr}.student-grades-head{flex-direction:column;align-items:stretch}.student-grade-search{min-width:0;width:100%}.student-grade-row{grid-template-columns:40px 1fr 70px;padding:12px 13px}.student-grade-avatar{width:36px;height:36px}.student-note{height:54px}.student-note b{font-size:22px}.student-grade-legend{flex-wrap:wrap;padding:9px 13px}.student-grade-legend a{width:100%;margin-left:0}.cleanup-bank-main{flex-direction:column;align-items:flex-start}.short-link-box{grid-template-columns:1fr}.topbar{height:68px;padding:0 13px}.brand-mark{width:38px;height:38px;font-size:18px}.navlinks{gap:3px}.navlinks a,.navlinks .install-app-link{padding:8px 8px;border-radius:12px}.navlinks .logout-link{display:flex;padding:8px 8px}.navlinks .install-app-link{display:flex;padding:8px 8px}main{padding:0 12px;margin-top:16px}.hero,.results-header,.welcome-panel{align-items:flex-start;flex-direction:column}.v7-welcome{padding:25px;min-height:auto}.welcome-mark{display:none}.quick-actions{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.span{grid-column:auto}.section-heading.split{align-items:flex-start;flex-direction:column}.search-box{min-width:0;width:100%}.student-id-card{grid-template-columns:1fr}.card-heading-row{align-items:flex-start;flex-direction:column}.school-average{gap:7px}.school-average b{font-size:18px}.result-exam-row{align-items:flex-start}.result-numbers{gap:9px}.mode-grid{grid-template-columns:1fr}}
    @media(max-width:440px){.dash-primary-actions{grid-template-columns:1fr 1fr}.dash-primary-actions>a{padding:10px}.dash-summary-card{padding:10px}.dash-summary-card>b{font-size:20px}.dash-tabs{position:sticky;top:68px;z-index:30}.dash-school-content{padding:8px}.dash-trimester-grid{padding:0 7px 7px}.dash-hero{padding:22px 18px}.dash-hero-actions{width:100%}.dash-hero-actions .btn{flex:1}.dash-action{font-size:8px!important}.rco-help-strip{grid-template-columns:1fr}.rco-hero{padding:22px 18px}.rco-school-card>summary{padding:16px}.rco-school-main h2{font-size:18px}.rco-exam-copy-row{align-items:flex-start}.rco-main-copy .btn{width:100%}.reset-card{padding:22px 15px}.reset-summary{grid-template-columns:1fr}.result-student-card{padding:22px 15px}.result-details-grid{grid-template-columns:1fr}.student-grade-number{letter-spacing:-2px}.brand>span:last-child{display:none}.quick-actions{grid-template-columns:1fr}.quick-card{padding:13px}.v7-welcome h1{font-size:31px}.v7-welcome p{font-size:14px}.cards{grid-template-columns:1fr 1fr}.dashboard-stats .stat{min-height:116px;padding:14px}.dashboard-stats .stat b{font-size:27px}.school-group>summary,.school-result-group>summary{padding:13px}.school-icon{width:43px;height:43px}.school-content{padding:0 11px 11px}.result-numbers span:first-child{display:none}.exam-grid{padding:0 9px 9px}}

    /* ========================= V26 · FUTURE UI ========================= */
    body{background:
      radial-gradient(circle at 8% 0%,rgba(73,121,255,.055),transparent 27%),
      radial-gradient(circle at 92% 10%,rgba(39,177,145,.045),transparent 25%),
      var(--bg)}
    .topbar{background:rgba(250,252,255,.86);border-bottom:1px solid rgba(211,221,236,.75);backdrop-filter:blur(18px) saturate(155%)}
    .brand-mark{background:linear-gradient(145deg,#225ce6,#4f82ff 56%,#4eb59b);box-shadow:0 10px 28px rgba(42,94,223,.24)}
    .future-home-hero{position:relative;overflow:hidden;min-height:345px;border-radius:29px;padding:32px;background:linear-gradient(122deg,#0f1d38 0%,#142b53 54%,#123f51 125%);color:#fff;box-shadow:0 24px 60px rgba(21,42,77,.22);display:grid;grid-template-columns:1.35fr .65fr;gap:28px;align-items:center;border:1px solid rgba(255,255,255,.08)}
    .future-hero-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(to right,black,transparent 85%)}
    .future-orb{position:absolute;border-radius:50%;filter:blur(1px);pointer-events:none}.orb-one{width:280px;height:280px;right:-95px;top:-120px;background:radial-gradient(circle,rgba(83,139,255,.34),rgba(83,139,255,0) 68%)}.orb-two{width:240px;height:240px;left:35%;bottom:-165px;background:radial-gradient(circle,rgba(61,203,164,.18),rgba(61,203,164,0) 70%)}
    .future-hero-copy{position:relative;z-index:2;max-width:700px}.future-hero-status{display:inline-flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.065);border-radius:999px;color:#b9c9e6;font-size:8px;font-weight:900;letter-spacing:1px}.future-live-dot{width:7px;height:7px;border-radius:50%;background:#55d7a8;box-shadow:0 0 0 5px rgba(85,215,168,.1),0 0 16px rgba(85,215,168,.55)}
    .future-eyebrow{margin-top:21px;color:#7fa8ff!important}.future-home-hero h1{font-size:clamp(35px,5.2vw,55px);line-height:1.02;letter-spacing:-2.1px;margin:7px 0 13px;max-width:720px}.future-home-hero h1 em{font-style:normal;background:linear-gradient(90deg,#77a2ff,#7ee3c5);-webkit-background-clip:text;background-clip:text;color:transparent}.future-home-hero p{max-width:610px;margin:0;color:#b6c4dc;font-size:13px;line-height:1.62}
    .future-hero-buttons{display:flex;gap:9px;flex-wrap:wrap;margin-top:24px}.future-main-button,.future-ghost-button{display:flex;align-items:center;gap:10px;border-radius:15px;padding:11px 13px;color:white;min-width:205px}.future-main-button{background:linear-gradient(135deg,#326be9,#5589ff);box-shadow:0 13px 28px rgba(38,100,230,.26)}.future-ghost-button{background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.13);backdrop-filter:blur(8px)}.future-main-button>span,.future-ghost-button>span{width:35px;height:35px;border-radius:11px;display:grid;place-items:center;background:rgba(255,255,255,.13);font-size:17px}.future-main-button>div,.future-ghost-button>div{display:flex;flex-direction:column;flex:1}.future-main-button b,.future-ghost-button b{font-size:11px}.future-main-button small,.future-ghost-button small{font-size:8px;color:#c6d4ea}.future-main-button>i{font-style:normal;font-size:18px}
    .future-command-card{position:relative;z-index:2;background:linear-gradient(145deg,rgba(255,255,255,.105),rgba(255,255,255,.052));border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 18px 45px rgba(4,12,27,.16);border-radius:23px;padding:18px;backdrop-filter:blur(15px)}.future-command-head{display:flex;align-items:center;justify-content:space-between;color:#91a7c9;font-size:7px;letter-spacing:1px;font-weight:900}.future-command-head i{width:7px;height:7px;border-radius:50%;background:#55d7a8;box-shadow:0 0 12px #55d7a8}.future-command-number{padding:22px 2px 16px;border-bottom:1px solid rgba(255,255,255,.09)}.future-command-number small{display:block;color:#8fa5c6;font-size:7px;letter-spacing:.8px;font-weight:900}.future-command-number b{display:block;font-size:52px;letter-spacing:-3px;margin-top:3px}.future-command-mini{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:11px 0}.future-command-mini>div{padding:9px 7px;border-radius:11px;background:rgba(255,255,255,.05);display:flex;flex-direction:column}.future-command-mini span{font-size:7px;color:#91a5c4}.future-command-mini b{font-size:17px;margin-top:2px}.future-signal{display:flex;gap:8px;align-items:center;padding:9px 10px;border-radius:12px;background:rgba(79,213,170,.08);border:1px solid rgba(79,213,170,.12)}.future-signal>span{width:27px;height:27px;border-radius:9px;background:rgba(79,213,170,.13);display:grid;place-items:center}.future-signal>span i{width:7px;height:7px;border-radius:50%;background:#55d7a8;box-shadow:0 0 10px #55d7a8}.future-signal>div{display:flex;flex-direction:column}.future-signal b{font-size:9px}.future-signal small{font-size:7px;color:#8fbbaa}
    .v26-primary-actions{grid-template-columns:repeat(6,1fr)!important;margin-top:14px}.v26-primary-actions>a{border-radius:16px;transition:.18s ease;position:relative;overflow:hidden}.v26-primary-actions>a:after{content:"";position:absolute;width:70px;height:70px;border-radius:50%;right:-34px;top:-35px;background:rgba(58,105,220,.045)}.v26-primary-actions>a:hover{transform:translateY(-2px);box-shadow:0 13px 26px rgba(35,56,91,.09)}.v26-featured-action{border-color:#cfe0ff!important;background:linear-gradient(135deg,#f7faff,#eef5ff)!important}

    /* Login */
    .future-login-shell{position:relative;isolation:isolate;min-height:100vh;max-width:none!important;margin:0!important;padding:28px 16px!important;display:grid;place-items:center;background:linear-gradient(145deg,#0b172d,#10264a 62%,#0e3b46);overflow:hidden}.future-login-shell:before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:38px 38px;z-index:-2}.future-login-glow{position:absolute;border-radius:50%;filter:blur(5px);z-index:-1}.glow-a{width:420px;height:420px;left:-180px;top:-170px;background:radial-gradient(circle,rgba(65,115,255,.33),transparent 68%)}.glow-b{width:420px;height:420px;right:-170px;bottom:-210px;background:radial-gradient(circle,rgba(66,212,170,.20),transparent 68%)}
    .future-login-card{width:min(520px,100%);border:1px solid rgba(255,255,255,.13);border-radius:29px;padding:28px;background:linear-gradient(145deg,rgba(255,255,255,.095),rgba(255,255,255,.055));box-shadow:0 30px 75px rgba(2,10,25,.3);backdrop-filter:blur(19px);color:white}.future-login-brand{display:flex;align-items:center;gap:10px}.future-login-logo{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(145deg,#3776ef,#598bff 62%,#55bfa4);box-shadow:0 11px 27px rgba(42,100,232,.32);font-weight:950}.future-login-brand>div{display:flex;flex-direction:column}.future-login-brand small{font-size:7px;letter-spacing:1.2px;color:#8fa8ce;font-weight:900}.future-login-brand b{font-size:17px}.future-login-copy{margin:38px 0 22px}.future-kicker{display:inline-flex;align-items:center;gap:7px;font-size:7px;letter-spacing:1px;color:#8da9d4;font-weight:900}.future-kicker i{width:7px;height:7px;border-radius:50%;background:#55d7a8;box-shadow:0 0 12px #55d7a8}.future-kicker.light{color:#c8d7ef}.future-login-copy h1{font-size:clamp(31px,8vw,45px);line-height:1.04;letter-spacing:-1.7px;margin:8px 0 11px}.future-login-copy h1 em{font-style:normal;background:linear-gradient(90deg,#78a2ff,#75dfc1);-webkit-background-clip:text;background-clip:text;color:transparent}.future-login-copy p{margin:0;color:#aabbd5;font-size:11px;line-height:1.6}.future-login-error{padding:10px 12px;border:1px solid rgba(255,123,135,.22);background:rgba(255,90,105,.09);color:#ffc4ca;border-radius:11px;font-size:10px}.future-login-form{display:grid;gap:12px}.future-login-form label>span{display:block;color:#a5b6d0;font-size:8px;font-weight:800;margin:0 0 6px 3px}.future-password-field{display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.13);background:rgba(2,11,26,.21);border-radius:13px;padding:0 11px}.future-password-field i{font-style:normal;color:#7697c9}.future-password-field input{border:0!important;background:transparent!important;color:white!important;box-shadow:none!important;padding:13px 0!important}.future-password-field input::placeholder{color:#7085a6}.future-login-button{border-radius:13px;padding:14px 15px;background:linear-gradient(135deg,#316be8,#5487ff)!important;box-shadow:0 12px 26px rgba(37,95,223,.28)!important;display:flex;justify-content:space-between}.future-login-button span{font-size:18px}.future-login-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid rgba(255,255,255,.08);padding-top:14px;margin-top:20px;color:#7087ab;font-size:7px}.future-login-foot span:first-child{display:flex;align-items:center;gap:5px}.future-online-dot{width:6px;height:6px;border-radius:50%;background:#55d7a8;box-shadow:0 0 9px #55d7a8}

    /* Central de alunos */
    .future-results-hub{max-width:1240px}.future-results-hero{position:relative;overflow:hidden;border-radius:25px;padding:24px 26px;background:linear-gradient(125deg,#11213f,#17335d 60%,#174b58);color:white;box-shadow:0 19px 45px rgba(21,43,80,.18);display:flex;align-items:center;justify-content:space-between;gap:18px}.future-results-orb{position:absolute;width:260px;height:260px;border-radius:50%;right:7%;top:-180px;background:radial-gradient(circle,rgba(89,142,255,.38),transparent 68%)}.future-results-hero>div:not(.future-results-orb){position:relative;z-index:1}.future-results-hero h1{font-size:clamp(29px,4vw,41px);letter-spacing:-1.4px;margin:6px 0}.future-results-hero p{margin:0;color:#b7c7df;font-size:11px}.future-results-badge{display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.07);border-radius:14px}.future-results-badge>span{width:35px;height:35px;border-radius:11px;background:rgba(255,255,255,.1);display:grid;place-items:center;font-size:18px}.future-results-badge>div{display:flex;flex-direction:column}.future-results-badge small{font-size:6px;color:#91a8ca}.future-results-badge b{font-size:11px}
    .future-filter-panel{margin:15px 0;background:rgba(255,255,255,.94);border:1px solid #e0e7f0;border-radius:22px;padding:18px;box-shadow:0 10px 30px rgba(32,54,88,.065)}.future-filter-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.future-filter-head h2{margin:3px 0;font-size:23px}.future-filter-head p{margin:0;color:var(--muted);font-size:9px}.future-clear-filter{background:#f3f6fa!important;color:#66748a!important;border:1px solid #e1e6ee!important;box-shadow:none!important;padding:8px 10px!important;font-size:9px!important}.future-filter-school{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.future-filter-school label>span{display:block;font-size:8px;color:#6d7b91;font-weight:900;letter-spacing:.4px;margin:0 0 5px 3px}.future-filter-school select{background:#f8fafd;border-color:#e0e6ef}.future-class-picker-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:14px 2px 7px}.future-class-picker-head>span{font-size:9px;font-weight:900;color:#66758c}.future-class-picker-head>div{display:flex;gap:5px}.future-mini-button{background:#f3f6fa!important;color:#5e6d83!important;border:1px solid #e1e6ee!important;box-shadow:none!important;padding:6px 8px!important;font-size:8px!important}.future-class-filter-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.future-class-filter{cursor:pointer}.future-class-filter input{position:absolute;opacity:0;pointer-events:none}.future-class-filter>span{display:flex;flex-direction:column;border:1px solid #e2e7ef;background:#fafbfd;border-radius:12px;padding:9px 10px;transition:.15s}.future-class-filter b{font-size:11px}.future-class-filter small{font-size:7px;color:#7d8ba0;margin-top:2px}.future-class-filter input:checked+span{border-color:#9fbef6;background:linear-gradient(135deg,#eef5ff,#f6faff);color:#245fcb;box-shadow:inset 0 0 0 1px rgba(50,103,220,.06)}.future-apply-filter{width:100%;margin-top:12px;border-radius:13px!important;padding:12px 14px!important;display:grid!important;grid-template-columns:auto 1fr auto!important;background:linear-gradient(135deg,#255fdb,#4d82f1)!important}.future-apply-filter>span{font-size:16px}.future-apply-filter>i{font-style:normal;font-size:17px}
    .future-selection-summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 15px;border:1px solid #dfe6ef;background:linear-gradient(135deg,#fff,#f8fbff);border-radius:18px;margin:13px 0}.future-selection-summary>div:first-child{display:flex;align-items:center;gap:9px}.future-selection-icon{width:40px;height:40px;border-radius:12px;background:#eaf2ff;color:#3167d7;display:grid;place-items:center;font-size:18px}.future-selection-summary>div:first-child>div{display:flex;flex-direction:column}.future-selection-summary small{font-size:7px;color:#7b899e;font-weight:900}.future-selection-summary b{font-size:12px}.future-selection-numbers{display:flex;gap:7px}.future-selection-numbers>span{min-width:85px;padding:7px 9px;border-radius:10px;background:#f3f6fa;display:flex;flex-direction:column}.future-selection-numbers b{font-size:17px;margin-top:1px}
    .future-results-groups{display:grid;gap:12px}.future-class-result{background:white;border:1px solid #e0e6ef;border-radius:20px;overflow:hidden;box-shadow:0 8px 24px rgba(34,55,86,.055);border-left:5px solid #4f7fe3}.future-class-result.future-class-2{border-left-color:#735fd2}.future-class-result.future-class-3{border-left-color:#47a086}.future-class-result.future-class-4{border-left-color:#d69a55}.future-class-result.future-class-5{border-left-color:#c97a93}.future-class-result>summary{display:flex;align-items:center;justify-content:space-between;gap:13px;padding:13px 14px;cursor:pointer;background:linear-gradient(120deg,#fff,#fafbfd)}.future-class-main{display:flex;align-items:center;gap:9px;min-width:0}.future-class-code{min-width:48px;height:48px;padding:0 7px;border-radius:13px;background:#edf4ff;color:#315fbd;display:grid;place-items:center;font-size:13px;font-weight:950}.future-class-main h2{font-size:17px;margin:1px 0}.future-class-main p{font-size:8px;color:#748197;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:430px}.future-mini-label{font-size:6px;letter-spacing:.6px;color:#8491a5;font-weight:900}.future-class-kpis{display:flex;align-items:center;gap:6px}.future-class-kpis>span{min-width:65px;padding:6px 8px;border-radius:10px;background:#f4f7fa;display:flex;flex-direction:column;text-align:center}.future-class-kpis small{font-size:6px;color:#7d899c;font-weight:900}.future-class-kpis b{font-size:13px;margin-top:1px}.future-class-body{padding:10px;background:#f8fafc;border-top:1px solid #edf0f5}.future-class-insight{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:11px;background:#eef5ff;border:1px solid #dbe7fa;margin-bottom:8px}.future-class-insight>span{width:29px;height:29px;border-radius:9px;background:white;color:#3569d0;display:grid;place-items:center}.future-class-insight>div{display:flex;flex-direction:column;flex:1}.future-class-insight b{font-size:9px}.future-class-insight small{font-size:7px;color:#6d7e97}.future-class-insight>a{font-size:8px;font-weight:900;white-space:nowrap}.future-student-results-list{display:grid;gap:6px}.future-student-result{display:grid;grid-template-columns:minmax(180px,1fr) 2fr;gap:10px;align-items:center;padding:8px 9px;border-radius:12px;background:white;border:1px solid #e6eaf0}.future-student-id{display:flex;align-items:center;gap:8px;min-width:0}.future-student-avatar{width:34px;height:34px;border-radius:10px;background:#edf4ff;color:#3268ce;display:grid;place-items:center;font-size:9px;font-weight:950;flex:none}.future-student-id>div{display:flex;flex-direction:column;min-width:0}.future-student-id b{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.future-student-id small{font-size:7px;color:#8490a2}.future-result-data{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}.future-result-data>span{min-height:42px;border-radius:9px;background:#f5f7fa;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:5px}.future-result-data small{font-size:5.5px;color:#7c889b;font-weight:900;letter-spacing:.25px}.future-result-data b{font-size:12px;margin-top:2px}.future-exit-alert{background:#fff3f3!important;color:#b94c54}.future-exit-clean{background:#edf8f3!important;color:#3d7d68}.future-discount-on{background:#fff5ea!important;color:#aa702d}.future-discount-off{background:#f3f6f9!important;color:#748096}.future-final-score{position:relative}.future-final-score i{font-size:5px;font-style:normal}.future-final-good{background:#eaf3ff!important;color:#2867cf}.future-final-low{background:#ffeded!important;color:#c7454d}.future-empty-result{padding:38px 18px;text-align:center;border:1px dashed #d4ddeb;border-radius:20px;background:rgba(255,255,255,.7)}.future-empty-result>span{width:55px;height:55px;border-radius:16px;background:#edf4ff;color:#336bd4;display:grid;place-items:center;margin:0 auto 10px;font-size:25px}.future-empty-result h2{margin:4px 0;font-size:20px}.future-empty-result p{margin:0;color:#7c899d;font-size:9px}.future-empty-start{margin-top:13px}
    @media(max-width:1000px){.future-home-hero{grid-template-columns:1fr}.future-command-card{max-width:480px}.v26-primary-actions{grid-template-columns:repeat(3,1fr)!important}.future-class-filter-grid{grid-template-columns:repeat(4,1fr)}.future-student-result{grid-template-columns:1fr}.future-class-kpis{flex-wrap:wrap;justify-content:flex-end}}
    @media(max-width:720px){.future-home-hero{padding:24px 19px;min-height:auto}.future-home-hero h1{font-size:37px}.future-command-card{width:100%;max-width:none}.future-hero-buttons{display:grid;grid-template-columns:1fr}.future-main-button,.future-ghost-button{min-width:0}.v26-primary-actions{grid-template-columns:1fr 1fr!important}.future-results-hero{align-items:flex-start;flex-direction:column;padding:20px}.future-filter-school{grid-template-columns:1fr}.future-class-filter-grid{grid-template-columns:repeat(3,1fr)}.future-selection-summary{align-items:flex-start;flex-direction:column}.future-selection-numbers{width:100%}.future-selection-numbers>span{flex:1;min-width:0}.future-class-result>summary{align-items:flex-start;flex-direction:column}.future-class-kpis{width:100%;justify-content:flex-start}.future-class-kpis>span{flex:1}.future-student-result{padding:9px}.future-result-data{grid-template-columns:repeat(5,minmax(55px,1fr));overflow:auto}.future-result-data>span{min-width:55px}.future-class-insight{align-items:flex-start}.future-class-insight>a{display:none}}
    @media(max-width:460px){.future-login-card{padding:21px 18px}.future-login-copy{margin-top:31px}.future-login-foot{align-items:flex-start;flex-direction:column}.future-home-hero h1{font-size:32px;letter-spacing:-1.3px}.future-command-number b{font-size:45px}.v26-primary-actions{grid-template-columns:1fr 1fr!important}.future-class-filter-grid{grid-template-columns:repeat(2,1fr)}.future-selection-numbers{display:grid;grid-template-columns:1fr 1fr}.future-selection-numbers>span:last-child{grid-column:1/-1}.future-class-main p{max-width:230px}.future-class-kpis>span{min-width:57px}.future-student-id b{font-size:11px}.future-result-data{gap:3px}.future-filter-head{align-items:flex-start;flex-direction:column}.future-class-picker-head{align-items:flex-start;flex-direction:column}}


    /* ========================= V29 · HOME THEMES ========================= */
    .future-theme-switcher{position:absolute;z-index:8;right:18px;top:17px;display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:999px;background:rgba(6,17,37,.24);border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(10px)}
    .theme-dot{width:18px!important;height:18px!important;min-width:18px!important;padding:0!important;border-radius:50%!important;border:2px solid rgba(255,255,255,.48)!important;box-shadow:none!important;transition:.16s ease}
    .theme-dot:nth-child(1){background:linear-gradient(135deg,#3768ff,#64d8bd)!important}
    .theme-dot:nth-child(2){background:linear-gradient(135deg,#036c91,#26c3d1)!important}
    .theme-dot:nth-child(3){background:linear-gradient(135deg,#f7fbff,#a8c9ff)!important}
    .theme-dot.active{transform:scale(1.18);box-shadow:0 0 0 3px rgba(255,255,255,.13)!important}
    .future-value-pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:16px}
    .future-value-pills span{padding:5px 7px;border-radius:999px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.055);color:#b9c9e2;font-size:6.5px;font-weight:800}

    /* Modelo 1 — Aurora: elegante, profundo, tecnológico */
    .future-home-hero.home-theme-aurora{
      background:
        radial-gradient(circle at 88% 16%,rgba(54,114,255,.25),transparent 30%),
        radial-gradient(circle at 35% 110%,rgba(70,211,177,.12),transparent 38%),
        linear-gradient(125deg,#0b1830 0%,#122b51 58%,#0f3c49 122%);
    }
    .home-theme-aurora .future-home-hero h1 em,
    .home-theme-aurora h1 em{
      background:linear-gradient(90deg,#78a8ff,#6ee2c5);
      -webkit-background-clip:text;background-clip:text;color:transparent;
    }

    /* Modelo 2 — Horizonte: mais vivo e esportivo */
    .future-home-hero.home-theme-ocean{
      background:
        radial-gradient(circle at 100% 0%,rgba(36,222,218,.24),transparent 34%),
        linear-gradient(128deg,#06396a 0%,#075f88 48%,#087f88 100%);
      border-color:rgba(160,238,238,.12);
    }
    .home-theme-ocean .future-hero-grid{opacity:.62}
    .home-theme-ocean .future-home-hero h1 em,
    .home-theme-ocean h1 em{
      background:linear-gradient(90deg,#8edbff,#8bf0d1);
      -webkit-background-clip:text;background-clip:text;color:transparent;
    }
    .home-theme-ocean .future-main-button{
      background:linear-gradient(135deg,#087dec,#18a6d9);
    }
    .home-theme-ocean .future-command-card{
      background:linear-gradient(145deg,rgba(255,255,255,.13),rgba(255,255,255,.065));
    }

    /* Modelo 3 — Luz: clean, sofisticado e menos escuro */
    .future-home-hero.home-theme-light{
      color:#142641;
      background:
        radial-gradient(circle at 90% 6%,rgba(80,140,255,.17),transparent 34%),
        radial-gradient(circle at 10% 120%,rgba(79,205,169,.13),transparent 34%),
        linear-gradient(135deg,#f9fbff,#eaf3ff 58%,#eefaf6);
      border-color:#dce7f3;
      box-shadow:0 22px 50px rgba(60,88,124,.12);
    }
    .home-theme-light .future-hero-grid{
      background-image:
        linear-gradient(rgba(64,94,130,.055) 1px,transparent 1px),
        linear-gradient(90deg,rgba(64,94,130,.055) 1px,transparent 1px);
    }
    .home-theme-light .future-hero-status{
      color:#54708f;background:rgba(255,255,255,.68);
      border-color:rgba(98,126,159,.16)
    }
    .home-theme-light .future-eyebrow{color:#3267d8!important}
    .home-theme-light h1{color:#142641}
    .home-theme-light h1 em{
      background:linear-gradient(90deg,#316fe7,#25a985);
      -webkit-background-clip:text;background-clip:text;color:transparent;
    }
    .home-theme-light p{color:#667a93}
    .home-theme-light .future-value-pills span{
      color:#557089;background:rgba(255,255,255,.64);
      border-color:#dce7f1;
    }
    .home-theme-light .future-ghost-button{
      color:#24405f;background:rgba(255,255,255,.68);
      border-color:#d7e3ef;
    }
    .home-theme-light .future-ghost-button small{color:#71849c}
    .home-theme-light .future-command-card{
      color:#18304f;background:rgba(255,255,255,.70);
      border-color:#d6e3ef;
      box-shadow:0 18px 40px rgba(66,91,121,.10);
    }
    .home-theme-light .future-command-head,
    .home-theme-light .future-command-number small,
    .home-theme-light .future-command-mini span{color:#6e829b}
    .home-theme-light .future-command-number{border-bottom-color:#dce6ef}
    .home-theme-light .future-command-mini>div{background:#f1f6fb}
    .home-theme-light .future-signal{
      background:#edf9f4;border-color:#d2ecdf
    }
    .home-theme-light .future-signal small{color:#648878}
    .home-theme-light .future-theme-switcher{
      background:rgba(255,255,255,.66);
      border-color:#d6e1ed;
    }
    .home-theme-light .theme-dot{border-color:rgba(71,101,138,.25)!important}

    @media(max-width:720px){
      .future-theme-switcher{right:13px;top:13px}
      .future-value-pills{margin-top:13px}
    }


    /* ========================= V30 · APP + SAIR ========================= */
    .v30-app-strip{display:grid;grid-template-columns:46px 1fr auto;gap:11px;align-items:center;margin:12px 0;padding:11px 13px;border-radius:16px;background:linear-gradient(135deg,#f7faff,#eef8f5);border:1px solid #dce7ef;box-shadow:0 6px 18px rgba(35,58,89,.04)}
    .v30-app-icon{width:45px;height:45px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#1d5be8,#2ab7a3);color:white;font-weight:950;box-shadow:0 8px 18px rgba(36,99,213,.18)}
    .v30-app-strip>div:nth-child(2){display:flex;flex-direction:column}.v30-app-strip>div:nth-child(2)>b{font-size:10px;margin:2px 0}.v30-app-strip>div:nth-child(2)>small{font-size:7.5px;line-height:1.4}
    @media(max-width:760px){.brand>span:last-child{display:none}.v30-app-strip{grid-template-columns:42px 1fr}.v30-app-strip>.btn{grid-column:1/-1;width:100%}.navlinks .logout-link{background:#fff0f1!important;color:#b43b45!important}.navlinks .install-app-link{background:#eef5ff!important;color:#2766cc!important}}
    @media(max-width:430px){.topbar{padding-left:10px;padding-right:8px}.brand-mark{width:34px;height:34px;font-size:16px}.navlinks a,.navlinks .install-app-link{padding:6px 7px}.nav-ico{font-size:20px}.navlinks .logout-link{padding:6px 7px}}


    /* ========================= V31 · RECUPERAÇÃO + MÉDIA + PDF ========================= */
    .recovery-link-card{display:grid;grid-template-columns:54px 1fr auto;gap:12px;align-items:center;margin:12px 0;padding:15px 16px;border-radius:19px;background:linear-gradient(135deg,#f7fbff,#eef7ff);border:1px solid #d4e2f5;box-shadow:0 7px 22px rgba(38,63,96,.05)}
    .recovery-link-card.is-recovery{background:linear-gradient(135deg,#f7f4ff,#f1edff);border-color:#ded4f5}
    .recovery-link-icon{width:52px;height:52px;border-radius:15px;display:grid;place-items:center;background:#e8f2ff;color:#2765c9;font-size:25px;font-weight:900}
    .is-recovery .recovery-link-icon{background:#ece7ff;color:#7257bf}
    .recovery-link-copy h2{font-size:16px;margin:3px 0}.recovery-link-copy p{font-size:9px;color:#65758b;line-height:1.45;margin:0}
    .recovery-link-status{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.recovery-link-status span{font-size:7px;font-weight:900;padding:5px 7px;border-radius:999px;background:white;border:1px solid #e0e7ef}
    .recovery-open{color:#27775f!important;background:#eaf8f1!important}.recovery-closed{color:#9a4c52!important;background:#fff0f1!important}
    .recovery-link-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
    .student-result-actions{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:5px;margin:13px 0}
    .student-pdf-button{display:flex;align-items:center;gap:7px;padding:10px 13px;border-radius:12px;background:#edf4ff;color:#245eb5;border:1px solid #d3e2f5;font-size:10px;font-weight:900;text-decoration:none}
    .student-result-actions small{font-size:7px;color:#7c8898;text-align:center}
    .final-average-page{max-width:1250px}
    .final-average-hero{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:24px 25px;border-radius:24px;background:linear-gradient(125deg,#142a51,#1c4c7c 60%,#176d70);color:white;box-shadow:0 18px 42px rgba(26,53,88,.17)}
    .final-average-hero h1{font-size:36px;letter-spacing:-1.2px;margin:5px 0}.final-average-hero p{font-size:10px;color:#bfd1e5;margin:0}
    .avg-hero-formula{min-width:250px;padding:13px 15px;border-radius:15px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.13);display:flex;flex-direction:column}
    .avg-hero-formula small{font-size:6px;color:#9eb5d3;font-weight:900}.avg-hero-formula b{font-size:13px;margin:4px 0}.avg-hero-formula span{font-size:8px;color:#8fe2c8}
    .avg-filter-card{display:grid;grid-template-columns:1.4fr 1fr .7fr auto;gap:8px;align-items:end;margin:13px 0;padding:13px;border-radius:16px;background:white;border:1px solid #dfe6ef;box-shadow:0 6px 18px rgba(34,57,88,.045)}
    .avg-filter-card label{font-size:8px;color:#66758a;font-weight:900}.avg-filter-card select{margin-top:5px}
    .avg-selected-context{display:flex;align-items:center;gap:9px;padding:10px 12px;background:#f4f8fd;border:1px solid #dfe8f2;border-radius:13px;margin:10px 0}.avg-selected-context>span{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:white}.avg-selected-context>div{display:flex;flex-direction:column}.avg-selected-context small{font-size:6px;color:#7a8799;font-weight:900}.avg-selected-context b{font-size:10px}
    .avg-rule-card{display:flex;gap:10px;align-items:center;margin:11px 0;padding:13px 14px;border-radius:16px;background:linear-gradient(135deg,#fff8e9,#fffdf8);border:1px solid #edd9ab}.avg-rule-card>span{width:42px;height:42px;border-radius:12px;background:white;display:grid;place-items:center;font-size:22px}.avg-rule-card b{font-size:11px}.avg-rule-card p{font-size:8px;line-height:1.5;color:#6d6045;margin:3px 0 0}
    .avg-assessment-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.avg-assessment-card{background:white;border:1px solid #e0e6ed;border-radius:15px;padding:11px}.avg-assessment-card>div:first-child,.avg-recovery-line{display:flex;align-items:center;gap:8px}.avg-assessment-code{width:35px;height:35px;border-radius:10px;background:#eaf3ff;color:#2863bf;display:grid;place-items:center;font-size:11px;font-weight:900}.avg-assessment-card b{font-size:9px}.avg-assessment-card small{display:block;font-size:7px;color:#7b8798;margin-top:1px}.avg-recovery-line{border-top:1px solid #edf0f4;margin-top:8px;padding-top:8px}.avg-recovery-line>span{width:29px;height:29px;border-radius:9px;background:#f0ecff;color:#7459c5;display:grid;place-items:center}
    .avg-minimum-warning{margin:10px 0;padding:10px 12px;border-radius:12px;background:#fff0f0;border:1px solid #efc5c8;color:#934049;font-size:9px}
    .avg-table-card{margin-top:11px;background:white;border:1px solid #e0e6ed;border-radius:17px;padding:12px;box-shadow:0 7px 21px rgba(36,57,87,.045)}.avg-table-title{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:8px}.avg-table-title h2{font-size:18px;margin:3px 0}.avg-legend{display:flex;gap:8px;flex-wrap:wrap}.avg-legend span{font-size:7px;color:#718096}.avg-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:3px}.legend-main{background:#4a7dde}.legend-recovery{background:#785bcf}
    .avg-final-table th{min-width:145px}.avg-final-table th:first-child{min-width:190px}.avg-pair-head{display:flex;flex-direction:column}.avg-pair-head b{font-size:10px}.avg-pair-head small{font-size:6px;white-space:normal}
    .avg-student-name{font-weight:850}.avg-pair-cell{display:grid;grid-template-columns:1fr 1fr;gap:4px;min-width:145px}.avg-pair-cell>span{display:flex;flex-direction:column;align-items:center;padding:5px;border-radius:8px;background:#f5f7fa;color:#617086}.avg-pair-cell small{font-size:6px}.avg-pair-cell b{font-size:11px}.avg-pair-cell .avg-used{background:#eaf3ff;color:#2864c4;box-shadow:inset 0 0 0 1px #c9dcf7}.avg-pair-cell .avg-used.recovery{background:#f1edff;color:#6e55ba;box-shadow:inset 0 0 0 1px #d9cff5}.avg-pair-cell strong{grid-column:1/-1;font-size:7px;text-align:center;color:#58687e}
    .avg-final{min-width:100px;display:flex;flex-direction:column;align-items:center;padding:8px;border-radius:10px}.avg-final small{font-size:6px;font-weight:900}.avg-final b{font-size:19px}.avg-final span{font-size:6px;text-align:center}.avg-final.good{background:#eaf3ff;color:#2865cb}.avg-final.low{background:#ffeded;color:#be4148}.avg-final.pending{background:#f2f4f7;color:#788598}
    .final-average-empty{text-align:center;padding:35px 16px;background:white;border:1px dashed #d4deea;border-radius:18px;margin-top:12px}.final-average-empty>span{width:54px;height:54px;border-radius:15px;background:#eef4ff;display:grid;place-items:center;margin:0 auto 8px;font-size:25px}.final-average-empty h2{margin:3px 0}.final-average-empty p{font-size:9px;color:#748197}.final-average-empty.compact{grid-column:1/-1;margin:0}
    @media(max-width:900px){.avg-filter-card{grid-template-columns:1fr 1fr}.avg-filter-card button{grid-column:1/-1}.final-average-hero{align-items:flex-start;flex-direction:column}.avg-hero-formula{min-width:0;width:100%}.avg-assessment-grid{grid-template-columns:1fr}.recovery-link-card{grid-template-columns:45px 1fr}.recovery-link-actions{grid-column:1/-1;justify-content:flex-start}}
    @media(max-width:560px){.avg-filter-card{grid-template-columns:1fr}.avg-table-title{align-items:flex-start;flex-direction:column}.final-average-hero h1{font-size:30px}}


    /* ========================= V32 · ESCOLHA RECUPERAÇÃO + ÍCONES ========================= */
    .v32-choice-card{border:1px solid #dbe5ef;background:linear-gradient(135deg,#fcfdff,#f7fbff)}
    .v32-choice-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
    .v32-choice-box{position:relative;display:grid;grid-template-columns:46px 1fr;gap:10px;align-items:start;padding:12px;border-radius:16px;border:1px solid #dce6f0;background:white;cursor:pointer;box-shadow:0 6px 16px rgba(36,59,92,.04)}
    .v32-choice-box.primary{background:linear-gradient(135deg,#eef5ff,#f8fbff)}
    .v32-choice-box input{margin-top:3px}
    .v32-choice-ill{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font-size:23px;background:linear-gradient(135deg,#edf4ff,#f7fbff);box-shadow:inset 0 0 0 1px #d7e4f3}
    .v32-choice-box b{display:block;font-size:10px;margin:1px 0 3px}
    .v32-choice-box small{display:block;font-size:7.4px;line-height:1.45;color:#6f7f93}
    .v32-primary-actions{display:grid!important;grid-template-columns:repeat(6,1fr)!important;gap:10px!important}
    .v32-action-card{position:relative;display:flex!important;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:10px;padding:14px 12px!important;border-radius:18px;background:white;border:1px solid #dce5ef;box-shadow:0 10px 22px rgba(30,53,84,.055);min-height:118px;overflow:hidden;transition:.18s ease}
    .v32-action-card:hover{transform:translateY(-2px);box-shadow:0 16px 28px rgba(30,53,84,.085)}
    .v32-action-card:before{content:"";position:absolute;right:-16px;top:-16px;width:72px;height:72px;border-radius:50%;opacity:.16}
    .v32-action-art{position:relative;z-index:1;width:48px;height:48px;border-radius:15px;display:grid;place-items:center;font-size:24px;background:white;box-shadow:0 8px 18px rgba(31,61,99,.08)}
    .v32-action-card div{position:relative;z-index:1;display:flex;flex-direction:column}
    .v32-action-card b{font-size:10px;color:#1b2e4a}
    .v32-action-card small{font-size:7px;color:#708096;line-height:1.3}
    .v32-action-card.blue{background:linear-gradient(135deg,#f7fbff,#eef5ff)} .v32-action-card.blue:before{background:#6da9ff}
    .v32-action-card.green{background:linear-gradient(135deg,#f7fffb,#eefbf4)} .v32-action-card.green:before{background:#59d69f}
    .v32-action-card.purple{background:linear-gradient(135deg,#faf7ff,#f2eeff)} .v32-action-card.purple:before{background:#9d7cff}
    .v32-action-card.orange{background:linear-gradient(135deg,#fffaf2,#fff4e4)} .v32-action-card.orange:before{background:#ffb14f}
    .v32-action-card.cyan{background:linear-gradient(135deg,#f4fdff,#ebfbff)} .v32-action-card.cyan:before{background:#59d4ea}
    .v32-action-card.gold{background:linear-gradient(135deg,#fffdf4,#fff8dd)} .v32-action-card.gold:before{background:#f1cd53}
    @media(max-width:1100px){.v32-primary-actions{grid-template-columns:repeat(3,1fr)!important}.v32-choice-grid{grid-template-columns:1fr}}
    @media(max-width:760px){.v32-primary-actions{grid-template-columns:repeat(2,1fr)!important}.v32-action-card{min-height:106px;padding:12px 10px!important}.v32-action-art{width:42px;height:42px;font-size:21px}}
    @media(max-width:460px){.v32-primary-actions{grid-template-columns:1fr 1fr!important}.v32-choice-box{grid-template-columns:40px 1fr}.v32-choice-ill{width:40px;height:40px;font-size:20px}}

  </style>`;
}

function shortExamToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => chars[b % chars.length]).join('');
}

async function uniqueExamToken(env) {
  for (let i = 0; i < 12; i++) {
    const token = shortExamToken();
    const exists = await env.DB.prepare('SELECT id FROM exams WHERE token=? LIMIT 1').bind(token).first();
    if (!exists) return token;
  }
  return crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
}
function examExitPenalty(e, exitCount) {
  const examMinutes = 50;
  const totalPoints = Math.max(0, Number(e?.total_points || 100));
  const exits = Math.max(0, Number(exitCount || 0));

  const perExitPoints = examMinutes > 0
    ? totalPoints / examMinutes
    : 0;

  const penaltyPoints = Math.round(
    perExitPoints * exits * 100
  ) / 100;

  const perExitPercent = totalPoints > 0
    ? Math.round((perExitPoints / totalPoints) * 1000) / 10
    : 0;

  const penaltyPercent = Math.round(
    perExitPercent * exits * 10
  ) / 10;

  return {
    exam_minutes: examMinutes,
    total_points: totalPoints,
    exits,
    per_exit_points: perExitPoints,
    per_exit_percent: perExitPercent,
    penalty_points: penaltyPoints,
    penalty_percent: penaltyPercent
  };
}

function formatPenaltyValue(value) {
  const n = Math.round(Number(value || 0) * 100) / 100;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2)
    .replace(/0+$/,'')
    .replace(/\.$/,'')
    .replace('.', ',');
}

function formatDuration(s) { s = Number(s || 0); const m = Math.floor(s / 60), sec = s % 60; return s ? `${m}m ${sec}s` : '—'; }
function csvSafe(v) { return String(v ?? '').replaceAll(';', ',').replaceAll('\n', ' '); }
function redirect(location) { return new Response(null, { status: 302, headers: { Location: location } }); }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function attr(v) { return esc(v).replaceAll('"', '&quot;'); }
