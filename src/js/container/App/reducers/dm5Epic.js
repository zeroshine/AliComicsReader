import { Observable } from 'rxjs/Observable';
import 'rxjs/add/observable/dom/ajax';
import 'rxjs/add/observable/bindCallback';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/observable/merge';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/filter';
import 'rxjs/add/observable/of';
import 'rxjs/add/observable/from';
import map from 'lodash/map';
import findIndex from 'lodash/findIndex';
import filter from 'lodash/filter';
import reduce from 'lodash/reduce';
import some from 'lodash/some';
import {
  updateTitle,
  updateComicsID,
  updateChapters,
  updateChapterList,
  concatImageList,
  loadImgSrc,
  updateChapterLatestIndex,
  updateChapterNowIndex,
  updateRenderIndex,
  updateReadedChapters,
  updateSubscribe,
} from './comics';
import { startScroll } from './scrollEpic';

const baseURL = 'http://www.dm5.com';
const FETCH_CHAPTER = 'FETCH_CHAPTER';
const FETCH_IMAGE_SRC = 'FETCH_IMAGE_SRC';
const FETCH_IMG_LIST = 'FETCH_IMG_LIST';
const UPDATE_READED = 'UPDATE_READED';

function fetchImgs$(chapter) {
  return Observable.ajax({
    url: `${baseURL}/${chapter}/`,
    responseType: 'document',
  }).mergeMap(function fetchImgPageHandler({ response }) {
    const node = response.querySelector('a.back');
    const script = response.querySelector('head > script:nth-child(17)')
      .textContent;
    const DM5_IMAGE_COUNT = /DM5_IMAGE_COUNT=(\d+);/.exec(script)[1];
    const DM5_CID = /DM5_CID=(\d+);/.exec(script)[1];
    const DM5_CURL = /DM5_CURL\s*=\s*\"\/(m\d+\/)\"/.exec(script)[1];
    const DM5_MID = /DM5_MID=(\d+);/.exec(script)[1];
    const DM5_VIEWSIGN_DT = /DM5_VIEWSIGN_DT=\s*\"([^"]*)\"/.exec(script)[1];
    const DM5_VIEWSIGN = /DM5_VIEWSIGN=\s*\"([^"]*)\"/.exec(script)[1];
    const imgList = Array.from({ length: DM5_IMAGE_COUNT }, (v, k) => ({
      src: `${baseURL}/${DM5_CURL}chapterfun.ashx?cid=${DM5_CID}&page=${k + 1}&key=&language=1&gtk=6&_cid=${DM5_CID}&_mid=${DM5_MID}&_dt=${DM5_VIEWSIGN_DT}&_sign=${DM5_VIEWSIGN}`,
      chapter: `m${DM5_CID}`,
    }));
    return Observable.of({
      chapter,
      imgList,
      comicsID: node.getAttribute('href').replace(/\//g, ''),
    });
  });
}

export function fetchImgSrcEpic(action$, store) {
  return action$.ofType(FETCH_IMAGE_SRC).mergeMap(action => {
    const { result, entity } = store.getState().comics.imageList;
    return Observable.from(result)
      .filter(item => {
        return (
          item >= action.begin &&
          item <= action.end &&
          entity[item].loading &&
          entity[item].type !== 'end'
        );
      })
      .mergeMap(id => {
        return Observable.ajax({
          url: entity[id].src,
          responseType: 'text',
          contentType: 'text/html; charset=utf-8',
        }).map(function fetchImgSrcHandler({ response }) {
          /* eslint-disable */
          let src, d, isrevtt, hd_c;
          // $FlowFixMe
          const arr = eval(response);
          if (hd_c && hd_c.length > 0 && isrevtt) {
            src = hd_c[0];
          } else if (typeof d !== 'undefined') {
            src = d[0];
          } else if (arr) {
            src = arr[0];
          }
          return loadImgSrc(src, id);
          /* eslint-enable */
        });
      });
  });
}

export function fetchImgSrc(begin, end) {
  return { type: FETCH_IMAGE_SRC, begin, end };
}

export function fetchChapterPage$(url) {
  return Observable.ajax({
    url,
    responseType: 'document',
  }).mergeMap(function fetchChapterPageHandler({ response }) {
    const chapterNodes = response.querySelectorAll(
      '#detail-list-select-1 > li > a,' +
      '#detail-list-select-1 > .chapteritem > li > a',
    );
    chapterNodes.forEach(node => node.removeChild(node.querySelector('span')));
    const titleNode = response.querySelector(
      '.banner_detail_form > .info > .title'
    );
    titleNode.removeChild(titleNode.querySelector('.right'));
    const title = titleNode.textContent.trim();
    const coverURL = response.querySelector(
      '.banner_detail_form > .cover > img',
    ).src;
    const chapterList = map(chapterNodes, n =>
      n.getAttribute('href').replace(/\//g, ''),
    );
    const chapters = reduce(
      chapterNodes,
      (acc, n) => ({
        ...acc,
        [n.getAttribute('href').replace(/\//g, '')]: {
          title: n.textContent,
          href: n.href,
        },
      }),
      {},
    );
    return Observable.of({ title, coverURL, chapterList, chapters });
  });
}

export function fetchImgListEpic(action$, store) {
  return action$.ofType(FETCH_IMG_LIST).mergeMap(action => {
    const { chapterList } = store.getState().comics;
    return fetchImgs$(chapterList[action.index]).mergeMap(({ imgList }) => {
      const nowImgList = store.getState().comics.imageList.result;
      if (nowImgList.length === 0) {
        return [
          concatImageList(imgList),
          updateRenderIndex(0, 6),
          fetchImgSrc(0, 6),
          startScroll(),
        ];
      }
      return [concatImageList(imgList)];
    });
  });
}

export function fetchImgList(index) {
  return { type: FETCH_IMG_LIST, index };
}

export function fetchChapterEpic(action$, store) {
  return action$.ofType(FETCH_CHAPTER).mergeMap(action =>
    fetchImgs$(action.chapter).mergeMap(({ chapter, imgList, comicsID }) => {
      return Observable.merge(
        Observable.of(updateComicsID(comicsID)),
        Observable.of(concatImageList(imgList)),
        Observable.of(updateRenderIndex(0, 6)),
        Observable.of(fetchImgSrc(0, 6)),
        Observable.of(startScroll()),
        fetchChapterPage$(
          `${baseURL}/${comicsID}`,
        ).mergeMap(({ title, coverURL, chapterList, chapters }) => {
          const chapterIndex = findIndex(chapterList, item => item === chapter);
          return Observable.bindCallback(
            chrome.storage.local.get,
          )().mergeMap(item => {
            const newItem = {
              ...item,
              update: filter(
                item.update,
                updateItem =>
                  updateItem.site !== 'dm5' || updateItem.chapterID !== chapter,
              ),
              history: [
                {
                  site: 'dm5',
                  comicsID,
                },
                ...filter(
                  item.history,
                  historyItem =>
                    historyItem.site !== 'dm5' ||
                    historyItem.comicsID !== comicsID,
                ),
              ],
              dm5: {
                ...item.dm5,
                [comicsID]: {
                  title,
                  chapters,
                  chapterList,
                  coverURL,
                  chapterURL: `${baseURL}/${comicsID}`,
                  lastReaded: chapter,
                  readedChapters: {
                    ...(item.dm5[comicsID]
                      ? item.dm5[comicsID].readedChapters
                      : {}),
                    [chapter]: chapter,
                  },
                },
              },
            };
            const subscribe = some(
              item.subscribe,
              citem => citem.site === 'dm5' && citem.comicsID === comicsID,
            );
            return Observable.merge(
              Observable.of(updateSubscribe(subscribe)),
              Observable.bindCallback(chrome.storage.local.set)(
                newItem,
              ).mergeMap(() => {
                chrome.browserAction.setBadgeText({
                  text: `${newItem.update.length === 0 ? '' : newItem.update.length}`,
                });
                const result$ = [
                  updateTitle(title),
                  updateReadedChapters(newItem.dm5[comicsID].readedChapters),
                  updateChapters(chapters),
                  updateChapterList(chapterList),
                  updateChapterNowIndex(chapterIndex),
                ];
                if (chapterIndex > 0) {
                  result$.push(
                    fetchImgList(chapterIndex - 1),
                    updateChapterLatestIndex(chapterIndex - 1),
                  );
                } else {
                  result$.push(updateChapterLatestIndex(chapterIndex - 1));
                }
                return result$;
              }),
            );
          });
        }),
      );
    }),
  );
}

export function fetchChapter(chapter) {
  return { type: FETCH_CHAPTER, chapter };
}

export function updateReadedEpic(action$, store) {
  return action$.ofType(UPDATE_READED).mergeMap(action =>
    Observable.bindCallback(chrome.storage.local.get)().mergeMap(item => {
      const { comicsID, chapterList } = store.getState().comics;
      const chapterID = chapterList[action.index];
      const newItem = {
        ...item,
        update: filter(
          item.update,
          uitem => uitem.site !== 'dm5' || uitem.chapterID !== chapterID,
        ),
        dm5: {
          ...item.dm5,
          [comicsID]: {
            ...item.dm5[comicsID],
            lastReaded: chapterID,
            readedChapters: {
              ...item.dm5[comicsID].readedChapters,
              [chapterID]: chapterID,
            },
          },
        },
      };
      return Observable.bindCallback(chrome.storage.local.set)(
        newItem,
      ).mergeMap(() => {
        chrome.browserAction.setBadgeText({
          text: `${newItem.update.length === 0 ? '' : newItem.update.length}`,
        });
        return [
          updateReadedChapters(newItem.dm5[comicsID].readedChapters),
          updateChapterNowIndex(action.index),
        ];
      });
    }),
  );
}

export function updateReaded(index) {
  return { type: UPDATE_READED, index };
}
